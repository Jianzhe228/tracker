use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use super::sync::{generate_export_json, import_json_data};
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
pub fn data_import_from_file(state: State<'_, AppState>, path: String) -> Result<String, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {}", e))?;

    let data: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("JSON 格式无效: {}", e))?;

    // Basic structure validation
    if data.get("tasks").is_none() || data.get("projects").is_none() {
        return Err("文件内容不是有效的 Tracker 导出数据".to_string());
    }

    import_json_data(&state, &data)?;

    Ok("导入成功".to_string())
}

#[tauri::command]
pub fn data_clear_all(state: State<'_, AppState>) -> Result<(), String> {
    let mut db = state.db().lock().map_err(|e| e.to_string())?;
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
    DELETE FROM task_subtask_history;
    DELETE FROM subtask_learn_log;
    DELETE FROM keyword_clusters;
    DELETE FROM subtask_patterns;
    DELETE FROM tasks;
    DELETE FROM recurring_rules;
    DELETE FROM projects;
    DELETE FROM ai_skills;
    DELETE FROM user_settings;

    INSERT INTO projects (id, title, color, icon) VALUES (1, '收集箱', '#6b7280', 'inbox');
    ",
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}
