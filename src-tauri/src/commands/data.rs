use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use super::sync::{generate_export_json, import_json_data, save_local_backup};
use crate::db::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub size_bytes: u64,
}

/// Export data as JSON to the app's internal exports directory.
#[tauri::command]
pub fn data_export_json(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<ExportResult, String> {
    let json_str = generate_export_json(&state)?;

    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let exports_dir = app_dir.join("exports");
    std::fs::create_dir_all(&exports_dir).map_err(|e| e.to_string())?;

    let filename = format!(
        "tracker_export_{}.json",
        chrono::Local::now().format("%Y%m%d_%H%M%S")
    );
    let file_path = exports_dir.join(&filename);

    std::fs::write(&file_path, &json_str).map_err(|e| e.to_string())?;

    let metadata = std::fs::metadata(&file_path).map_err(|e| e.to_string())?;

    Ok(ExportResult {
        path: file_path.to_string_lossy().to_string(),
        size_bytes: metadata.len(),
    })
}

/// Export data as JSON to a user-chosen file path.
#[tauri::command]
pub fn data_export_to_file(
    state: State<'_, AppState>,
    path: String,
) -> Result<ExportResult, String> {
    let json_str = generate_export_json(&state)?;
    std::fs::write(&path, &json_str).map_err(|e| format!("写入文件失败: {}", e))?;
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;

    Ok(ExportResult {
        path,
        size_bytes: metadata.len(),
    })
}

/// Import data from a user-chosen JSON file, replacing all local data.
#[tauri::command]
pub fn data_import_from_file(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    path: String,
) -> Result<String, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {}", e))?;

    let data: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("JSON 格式无效: {}", e))?;

    // Basic structure validation
    if data.get("tasks").is_none() || data.get("projects").is_none() {
        return Err("文件内容不是有效的 Tracker 导出数据".to_string());
    }

    // The import wipes everything — snapshot current data first so a bad
    // file is recoverable from backups/.
    let backup_json = generate_export_json(&state)?;
    save_local_backup(&app_handle, &backup_json).map_err(|e| format!("导入前备份失败: {}", e))?;

    import_json_data(&state, &data)?;

    Ok("导入成功".to_string())
}

#[tauri::command]
pub fn data_clear_all(state: State<'_, AppState>) -> Result<(), String> {
    let mut db = state.db().lock().map_err(|e| e.to_string())?;
    clear_all_impl(&mut db)
}

fn clear_all_impl(db: &mut rusqlite::Connection) -> Result<(), String> {
    let tx = db.transaction().map_err(|e| e.to_string())?;

    tx.execute_batch(
        "
    DELETE FROM focus_session_segments;
    DELETE FROM task_completion_logs;
    DELETE FROM task_deletion_logs;
    DELETE FROM focus_sessions;
    DELETE FROM notification_logs;
    DELETE FROM ai_jobs;
    DELETE FROM suggestion_feedback;
    DELETE FROM suggestion_candidates;
    DELETE FROM suggestion_runs;
    DELETE FROM pending_predictions;
    DELETE FROM task_creation_history;
    DELETE FROM task_subtask_history;
    DELETE FROM subtask_learn_log;
    DELETE FROM keyword_clusters;
    DELETE FROM subtask_patterns;
    DELETE FROM tasks;
    DELETE FROM recurring_rules;
    DELETE FROM projects;
    DELETE FROM ai_skills;
    DELETE FROM user_settings;
    ",
    )
    .map_err(|e| e.to_string())?;

    // Restore the rows every database must contain (inbox project + builtin
    // AI skills) — the suggestion pipeline depends on the task_decompose skill.
    crate::db::seed_builtin_data(&tx).map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::clear_all_impl;

    fn setup_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        crate::db::run_migrations(&conn).expect("apply schema");
        conn
    }

    #[test]
    fn clear_all_wipes_behavior_archive_tables_and_reseeds_builtins() {
        let mut conn = setup_db();
        conn.execute_batch(
            "INSERT INTO tasks (id, title, status, priority, project_id, pomodoro_count, pomodoro_duration, sort_order, created_at, updated_at)
             VALUES (1, '写周报', 'todo', 0, 1, 1, 25, 0, '2026-06-01T09:00:00Z', '2026-06-01T09:00:00Z');
             INSERT INTO task_creation_history (task_title, created_at) VALUES ('写周报', '2026-06-01T09:00:00Z');
             INSERT INTO pending_predictions (title) VALUES ('写周报');
             INSERT INTO suggestion_runs (task_id, task_title) VALUES (1, '写周报');
             INSERT INTO suggestion_candidates (run_id, title, source) VALUES (1, '整理数据', 'learning');",
        )
        .expect("seed rows");

        clear_all_impl(&mut conn).expect("clear all");

        for table in [
            "task_creation_history",
            "pending_predictions",
            "suggestion_runs",
            "suggestion_candidates",
        ] {
            let n: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |r| r.get(0))
                .expect("count");
            assert_eq!(n, 0, "{} should be empty after clear", table);
        }

        let skills: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM ai_skills WHERE is_builtin = 1 AND enabled = 1",
                [],
                |r| r.get(0),
            )
            .expect("count skills");
        assert!(skills > 0, "builtin skills must be reseeded after clear");
    }
}
