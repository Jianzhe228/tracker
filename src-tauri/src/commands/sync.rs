use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::db::AppState;
use crate::services::webdav::WebDavClient;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusResult {
    pub last_sync_at: Option<String>,
}

#[tauri::command]
pub fn webdav_test_connection(
    url: String,
    username: String,
    password: String,
    path: String,
) -> Result<String, String> {
    let client = WebDavClient::new(&url, &username, &password, &path)?;
    client.test_connection()?;
    Ok("连接成功".to_string())
}

#[tauri::command]
pub fn webdav_upload(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    url: String,
    username: String,
    password: String,
    path: String,
) -> Result<String, String> {
    let client = WebDavClient::new(&url, &username, &password, &path)?;

    // Generate export JSON (reuse data.rs logic inline)
    let json_data = generate_export_json(&state)?;

    // Ensure remote directory exists
    client.ensure_directory()?;

    // Upload
    client.upload(json_data.as_bytes())?;

    // Write lastSyncAt to settings
    let now = chrono::Utc::now().to_rfc3339();
    {
        let db = state.db().lock().map_err(|e| e.to_string())?;
        db.execute(
      "INSERT INTO user_settings (key, value, updated_at) VALUES ('lastSyncAt', ?1, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
      rusqlite::params![now],
    )
    .map_err(|e| e.to_string())?;
    }

    // Also save a local backup
    save_local_backup(&app_handle, &json_data)?;

    Ok(format!("上传成功 ({})", now))
}

#[tauri::command]
pub fn webdav_download(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    url: String,
    username: String,
    password: String,
    path: String,
) -> Result<String, String> {
    let client = WebDavClient::new(&url, &username, &password, &path)?;

    // Download remote data
    let remote_bytes = client.download()?;
    let remote_str = String::from_utf8(remote_bytes)
        .map_err(|e| format!("Invalid UTF-8 in remote data: {}", e))?;

    // Parse to verify it's valid JSON
    let remote_data: serde_json::Value = serde_json::from_str(&remote_str)
        .map_err(|e| format!("Invalid JSON in remote data: {}", e))?;

    // Backup current database before importing
    let current_backup = generate_export_json(&state)?;
    save_local_backup(&app_handle, &current_backup)?;

    // Import remote data in a transaction
    import_json_data(&state, &remote_data)?;

    // Write lastSyncAt
    let now = chrono::Utc::now().to_rfc3339();
    {
        let db = state.db().lock().map_err(|e| e.to_string())?;
        db.execute(
      "INSERT INTO user_settings (key, value, updated_at) VALUES ('lastSyncAt', ?1, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
      rusqlite::params![now],
    )
    .map_err(|e| e.to_string())?;
    }

    Ok(format!("下载成功 ({})", now))
}

#[tauri::command]
pub fn webdav_sync_status(state: State<'_, AppState>) -> Result<SyncStatusResult, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    let last_sync_at: Option<String> = db
        .query_row(
            "SELECT value FROM user_settings WHERE key = 'lastSyncAt'",
            [],
            |row| row.get(0),
        )
        .ok();

    Ok(SyncStatusResult { last_sync_at })
}

/// Generate the export JSON string from the database.
pub(crate) fn generate_export_json(state: &State<'_, AppState>) -> Result<String, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    generate_export_json_from_db(&db)
}

pub(crate) fn generate_export_json_from_db(db: &rusqlite::Connection) -> Result<String, String> {
    // Collect tasks
    let mut task_stmt = db
    .prepare("SELECT id, title, status, priority, project_id, parent_id, due_at, reminder_time, completed_at, deleted_at, notes, pomodoro_count, pomodoro_duration, sort_order, recurring_rule_id, start_at, created_at, updated_at, rescheduled_to FROM tasks")
    .map_err(|e| e.to_string())?;
    let task_rows = task_stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
              "id": row.get::<_, i64>(0)?,
              "title": row.get::<_, String>(1)?,
              "status": row.get::<_, String>(2)?,
              "priority": row.get::<_, i64>(3)?,
              "projectId": row.get::<_, Option<i64>>(4)?,
              "parentId": row.get::<_, Option<i64>>(5)?,
              "dueAt": row.get::<_, Option<String>>(6)?,
              "reminderTime": row.get::<_, Option<String>>(7)?,
              "completedAt": row.get::<_, Option<String>>(8)?,
              "deletedAt": row.get::<_, Option<String>>(9)?,
              "notes": row.get::<_, Option<String>>(10)?,
              "pomodoroCount": row.get::<_, i64>(11)?,
              "pomodoroDuration": row.get::<_, i64>(12)?,
              "sortOrder": row.get::<_, i64>(13)?,
              "recurringRuleId": row.get::<_, Option<i64>>(14)?,
              "startAt": row.get::<_, Option<String>>(15)?,
              "createdAt": row.get::<_, String>(16)?,
              "updatedAt": row.get::<_, String>(17)?,
              "rescheduledTo": row.get::<_, Option<String>>(18)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut tasks = Vec::new();
    for row in task_rows {
        tasks.push(row.map_err(|e| e.to_string())?);
    }

    // Collect projects
    let mut proj_stmt = db
        .prepare("SELECT id, title, color, icon, parent_id, created_at, updated_at FROM projects")
        .map_err(|e| e.to_string())?;
    let project_rows = proj_stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
              "id": row.get::<_, i64>(0)?,
              "title": row.get::<_, String>(1)?,
              "color": row.get::<_, Option<String>>(2)?,
              "icon": row.get::<_, Option<String>>(3)?,
              "parentId": row.get::<_, Option<i64>>(4)?,
              "createdAt": row.get::<_, String>(5)?,
              "updatedAt": row.get::<_, String>(6)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut projects = Vec::new();
    for row in project_rows {
        projects.push(row.map_err(|e| e.to_string())?);
    }

    // Collect focus_sessions
    let mut fs_stmt = db
    .prepare("SELECT id, task_id, start_time, end_time, duration_seconds, type, status, interruption_reason, pomodoro_count, created_at FROM focus_sessions")
    .map_err(|e| e.to_string())?;
    let focus_session_rows = fs_stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
              "id": row.get::<_, i64>(0)?,
              "taskId": row.get::<_, Option<i64>>(1)?,
              "startTime": row.get::<_, String>(2)?,
              "endTime": row.get::<_, Option<String>>(3)?,
              "durationSeconds": row.get::<_, i64>(4)?,
              "type": row.get::<_, String>(5)?,
              "status": row.get::<_, String>(6)?,
              "interruptionReason": row.get::<_, Option<String>>(7)?,
              "pomodoroCount": row.get::<_, f64>(8)?,
              "createdAt": row.get::<_, String>(9)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut focus_sessions = Vec::new();
    for row in focus_session_rows {
        focus_sessions.push(row.map_err(|e| e.to_string())?);
    }

    // Collect settings. Credentials must stay local: export files travel
    // off-device (WebDAV upload, local backups, user-chosen export paths).
    let mut settings_stmt = db
        .prepare(
            "SELECT key, value FROM user_settings
             WHERE key NOT IN ('webdavPassword', 'aiApiKey')",
        )
        .map_err(|e| e.to_string())?;
    let setting_rows = settings_stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
              "key": row.get::<_, String>(0)?,
              "value": row.get::<_, String>(1)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut settings = Vec::new();
    for row in setting_rows {
        settings.push(row.map_err(|e| e.to_string())?);
    }

    // Collect recurring_rules
    let mut rr_stmt = db
    .prepare("SELECT id, title, description, priority, project_id, repeat_type, repeat_days, anchor_date, reminder_time, notes, pomodoro_count, pomodoro_duration, active, last_generated_date, created_at, updated_at FROM recurring_rules")
    .map_err(|e| e.to_string())?;
    let recurring_rule_rows = rr_stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
              "id": row.get::<_, i64>(0)?,
              "title": row.get::<_, String>(1)?,
              "description": row.get::<_, Option<String>>(2)?,
              "priority": row.get::<_, i64>(3)?,
              "projectId": row.get::<_, Option<i64>>(4)?,
              "repeatType": row.get::<_, String>(5)?,
              "repeatDays": row.get::<_, Option<String>>(6)?,
              "anchorDate": row.get::<_, String>(7)?,
              "reminderTime": row.get::<_, Option<String>>(8)?,
              "notes": row.get::<_, Option<String>>(9)?,
              "pomodoroCount": row.get::<_, i64>(10)?,
              "pomodoroDuration": row.get::<_, i64>(11)?,
              "active": row.get::<_, bool>(12)?,
              "lastGeneratedDate": row.get::<_, Option<String>>(13)?,
              "createdAt": row.get::<_, String>(14)?,
              "updatedAt": row.get::<_, String>(15)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut recurring_rules = Vec::new();
    for row in recurring_rule_rows {
        recurring_rules.push(row.map_err(|e| e.to_string())?);
    }

    let export_data = serde_json::json!({
      "version": 1,
      "exportedAt": chrono::Utc::now().to_rfc3339(),
      "tasks": tasks,
      "projects": projects,
      "focusSessions": focus_sessions,
      "settings": settings,
      "recurringRules": recurring_rules,
      "taskCompletionLogs": collect_task_completion_logs(db)?,
      "focusSessionSegments": collect_focus_session_segments(&db)?,
      "aiSkills": collect_ai_skills(&db)?,
      "aiJobs": collect_ai_jobs(&db)?,
      "subtaskPatterns": collect_subtask_patterns(&db)?,
      "subtaskLearnLog": collect_subtask_learn_log(&db)?,
      "keywordClusters": collect_keyword_clusters(&db)?,
      "suggestionFeedback": collect_suggestion_feedback(&db)?,
      "taskSubtaskHistory": collect_task_subtask_history(&db)?,
    });

    serde_json::to_string_pretty(&export_data).map_err(|e| e.to_string())
}

/// Save a local backup JSON file before destructive operations.
pub(crate) fn save_local_backup(app_handle: &AppHandle, json_data: &str) -> Result<(), String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let backups_dir = app_dir.join("backups");
    std::fs::create_dir_all(&backups_dir).map_err(|e| e.to_string())?;

    let filename = format!(
        "sync_backup_{}.json",
        chrono::Local::now().format("%Y%m%d_%H%M%S")
    );
    let file_path = backups_dir.join(&filename);
    std::fs::write(&file_path, json_data).map_err(|e| e.to_string())?;

    // Keep only the last 7 backup files
    cleanup_old_backups(&backups_dir);

    Ok(())
}

/// Remove old backup files, keeping only the most recent 7.
fn cleanup_old_backups(backups_dir: &std::path::Path) {
    if let Ok(entries) = std::fs::read_dir(backups_dir) {
        let mut files: Vec<_> = entries
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_str()
                    .map(|n| n.starts_with("sync_backup_") && n.ends_with(".json"))
                    .unwrap_or(false)
            })
            .collect();

        files.sort_by_key(|f| std::cmp::Reverse(f.file_name()));

        for old_file in files.into_iter().skip(7) {
            let _ = std::fs::remove_file(old_file.path());
        }
    }
}

/// Import JSON data into the database, replacing all existing data.
pub(crate) fn import_json_data(
    state: &State<'_, AppState>,
    data: &serde_json::Value,
) -> Result<(), String> {
    let mut db = state.db().lock().map_err(|e| e.to_string())?;
    import_json_data_to_db(&mut db, data)
}

pub(crate) fn import_json_data_to_db(
    db: &mut rusqlite::Connection,
    data: &serde_json::Value,
) -> Result<(), String> {
    if data.get("version").and_then(|v| v.as_i64()) != Some(1) {
        return Err("备份文件版本不受支持，需要 version 1 的导出文件".to_string());
    }

    let tx = db.transaction().map_err(|e| e.to_string())?;

    // Clear existing data
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
    ",
    )
    .map_err(|e| format!("Failed to clear data: {}", e))?;

    // Import projects
    if let Some(projects) = data.get("projects").and_then(|v| v.as_array()) {
        for p in projects {
            tx.execute(
        "INSERT INTO projects (id, title, color, icon, parent_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
          p["id"].as_i64(),
          p["title"].as_str().unwrap_or(""),
          p["color"].as_str(),
          p["icon"].as_str(),
          p["parentId"].as_i64(),
          p["createdAt"].as_str().unwrap_or(""),
          p["updatedAt"].as_str().unwrap_or(""),
        ],
      )
      .map_err(|e| format!("Failed to import project: {}", e))?;
        }
    }

    // Import recurring_rules (before tasks, since tasks reference them)
    if let Some(rules) = data.get("recurringRules").and_then(|v| v.as_array()) {
        for r in rules {
            tx.execute(
        "INSERT INTO recurring_rules (id, title, description, priority, project_id, repeat_type, repeat_days, anchor_date, reminder_time, notes, pomodoro_count, pomodoro_duration, active, last_generated_date, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        rusqlite::params![
          r["id"].as_i64(),
          r["title"].as_str().unwrap_or(""),
          r["description"].as_str(),
          r["priority"].as_i64().unwrap_or(0),
          r["projectId"].as_i64(),
          r["repeatType"].as_str().unwrap_or(""),
          r["repeatDays"].as_str(),
          r["anchorDate"].as_str().unwrap_or(""),
          r["reminderTime"].as_str(),
          r["notes"].as_str(),
          r["pomodoroCount"].as_i64().unwrap_or(1),
          r["pomodoroDuration"].as_i64().unwrap_or(25),
          r["active"].as_bool().unwrap_or(true),
          r["lastGeneratedDate"].as_str(),
          r["createdAt"].as_str().unwrap_or(""),
          r["updatedAt"].as_str().unwrap_or(""),
        ],
      )
      .map_err(|e| format!("Failed to import recurring rule: {}", e))?;
        }
    }

    // Import tasks
    if let Some(tasks) = data.get("tasks").and_then(|v| v.as_array()) {
        for t in tasks {
            tx.execute(
        "INSERT INTO tasks (id, title, status, priority, project_id, parent_id, due_at, reminder_time, completed_at, deleted_at, notes, pomodoro_count, pomodoro_duration, sort_order, recurring_rule_id, start_at, created_at, updated_at, rescheduled_to) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
        rusqlite::params![
          t["id"].as_i64(),
          t["title"].as_str().unwrap_or(""),
          t["status"].as_str().unwrap_or("todo"),
          t["priority"].as_i64().unwrap_or(0),
          t["projectId"].as_i64(),
          t["parentId"].as_i64(),
          t["dueAt"].as_str(),
          t["reminderTime"].as_str(),
          t["completedAt"].as_str(),
          t["deletedAt"].as_str(),
          t["notes"].as_str(),
          t["pomodoroCount"].as_i64().unwrap_or(1),
          t["pomodoroDuration"].as_i64().unwrap_or(25),
          t["sortOrder"].as_i64().unwrap_or(0),
          t["recurringRuleId"].as_i64(),
          t["startAt"].as_str(),
          t["createdAt"].as_str().unwrap_or(""),
          t["updatedAt"].as_str().unwrap_or(""),
          t["rescheduledTo"].as_str(),
        ],
      )
      .map_err(|e| format!("Failed to import task: {}", e))?;
        }
    }

    // Import focus_sessions
    if let Some(sessions) = data.get("focusSessions").and_then(|v| v.as_array()) {
        for s in sessions {
            tx.execute(
        "INSERT INTO focus_sessions (id, task_id, start_time, end_time, duration_seconds, type, status, interruption_reason, pomodoro_count, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
          s["id"].as_i64(),
          s["taskId"].as_i64(),
          s["startTime"].as_str().unwrap_or(""),
          s["endTime"].as_str(),
          s["durationSeconds"].as_i64().unwrap_or(0),
          s["type"].as_str().unwrap_or(""),
          s["status"].as_str().unwrap_or(""),
          s["interruptionReason"].as_str(),
          s["pomodoroCount"].as_f64().unwrap_or(0.0),
          s["createdAt"].as_str().unwrap_or(""),
        ],
      )
      .map_err(|e| format!("Failed to import focus session: {}", e))?;
        }
    }

    // Import task_completion_logs
    if let Some(logs) = data.get("taskCompletionLogs").and_then(|v| v.as_array()) {
        for log in logs {
            tx.execute(
                "INSERT INTO task_completion_logs (
           id, task_id, task_title, estimated_seconds, actual_seconds, deviation_percentage,
           deviation_reason, reflection, next_improvement, personal_notes, completed_at, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                rusqlite::params![
                    log["id"].as_i64(),
                    log["taskId"].as_i64(),
                    log["taskTitle"].as_str().unwrap_or(""),
                    log["estimatedSeconds"].as_i64().unwrap_or(0),
                    log["actualSeconds"].as_i64().unwrap_or(0),
                    log["deviationPercentage"].as_f64(),
                    log["deviationReason"].as_str(),
                    log["reflection"].as_str(),
                    log["nextImprovement"].as_str(),
                    log["personalNotes"].as_str(),
                    log["completedAt"].as_str().unwrap_or(""),
                    log["createdAt"].as_str(),
                ],
            )
            .map_err(|e| format!("Failed to import task completion log: {}", e))?;
        }
    }

    // Import settings (skip lastSyncAt as we'll write it separately)
    if let Some(settings) = data.get("settings").and_then(|v| v.as_array()) {
        for s in settings {
            let key = s["key"].as_str().unwrap_or("");
            if key == "lastSyncAt" {
                continue;
            }
            tx.execute(
        "INSERT INTO user_settings (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
        rusqlite::params![key, s["value"].as_str().unwrap_or("")],
      )
      .map_err(|e| format!("Failed to import setting: {}", e))?;
        }
    }

    // Import focus_session_segments
    if let Some(segments) = data.get("focusSessionSegments").and_then(|v| v.as_array()) {
        for s in segments {
            tx.execute(
        "INSERT INTO focus_session_segments (id, session_id, task_id, start_time, duration_seconds, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
          s["id"].as_i64(),
          s["sessionId"].as_i64(),
          s["taskId"].as_i64(),
          s["startTime"].as_str().unwrap_or(""),
          s["durationSeconds"].as_i64().unwrap_or(0),
          s["sortOrder"].as_i64().unwrap_or(0),
          s["createdAt"].as_str().unwrap_or(""),
        ],
      )
      .map_err(|e| format!("Failed to import focus session segment: {}", e))?;
        }
    }

    // Import ai_skills
    if let Some(skills) = data.get("aiSkills").and_then(|v| v.as_array()) {
        for s in skills {
            tx.execute(
        "INSERT INTO ai_skills (id, key, name, description, system_prompt, user_prompt_template, action_types, trigger_type, is_builtin, enabled, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        rusqlite::params![
          s["id"].as_i64(),
          s["key"].as_str().unwrap_or(""),
          s["name"].as_str().unwrap_or(""),
          s["description"].as_str().unwrap_or(""),
          s["systemPrompt"].as_str().unwrap_or(""),
          s["userPromptTemplate"].as_str().unwrap_or(""),
          s["actionTypes"].as_str().unwrap_or("[]"),
          s["triggerType"].as_str().unwrap_or("manual"),
          s["isBuiltin"].as_bool().unwrap_or(false),
          s["enabled"].as_bool().unwrap_or(true),
          s["createdAt"].as_str().unwrap_or(""),
          s["updatedAt"].as_str().unwrap_or(""),
        ],
      )
      .map_err(|e| format!("Failed to import ai skill: {}", e))?;
        }
    }

    // Import ai_jobs
    if let Some(jobs) = data.get("aiJobs").and_then(|v| v.as_array()) {
        for j in jobs {
            tx.execute(
        "INSERT INTO ai_jobs (id, skill_id, status, input_context, raw_response, actions, error, created_at, completed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
          j["id"].as_i64(),
          j["skillId"].as_i64(),
          j["status"].as_str().unwrap_or("pending"),
          j["inputContext"].as_str().unwrap_or("{}"),
          j["rawResponse"].as_str(),
          j["actions"].as_str(),
          j["error"].as_str(),
          j["createdAt"].as_str().unwrap_or(""),
          j["completedAt"].as_str(),
        ],
      )
      .map_err(|e| format!("Failed to import ai job: {}", e))?;
        }
    }

    // Import subtask_patterns
    if let Some(patterns) = data.get("subtaskPatterns").and_then(|v| v.as_array()) {
        for p in patterns {
            tx.execute(
        "INSERT INTO subtask_patterns (id, name, keywords, subtasks, project_id, is_builtin, usage_count, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
          p["id"].as_i64(),
          p["name"].as_str().unwrap_or(""),
          p["keywords"].as_str().unwrap_or("[]"),
          p["subtasks"].as_str().unwrap_or("[]"),
          p["projectId"].as_i64(),
          p["isBuiltin"].as_bool().unwrap_or(false),
          p["usageCount"].as_i64().unwrap_or(0),
          p["createdAt"].as_str().unwrap_or(""),
          p["updatedAt"].as_str().unwrap_or(""),
        ],
      )
      .map_err(|e| format!("Failed to import subtask pattern: {}", e))?;
        }
    }

    // Import subtask_learn_log
    if let Some(logs) = data.get("subtaskLearnLog").and_then(|v| v.as_array()) {
        for l in logs {
            tx.execute(
        "INSERT INTO subtask_learn_log (id, cluster_id, project_id, keyword, subtask_title, score, source, last_used_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
          l["id"].as_i64(),
          l["clusterId"].as_i64(),
          l["projectId"].as_i64(),
          l["keyword"].as_str().unwrap_or(""),
          l["subtaskTitle"].as_str().unwrap_or(""),
          l["score"].as_i64().unwrap_or(1),
          l["source"].as_str().unwrap_or("user"),
          l["lastUsedAt"].as_str().unwrap_or(""),
          l["createdAt"].as_str().unwrap_or(""),
        ],
      )
      .map_err(|e| format!("Failed to import subtask learn log: {}", e))?;
        }
    }

    // Import keyword_clusters
    if let Some(clusters) = data.get("keywordClusters").and_then(|v| v.as_array()) {
        for c in clusters {
            tx.execute(
        "INSERT INTO keyword_clusters (id, name, keywords, confirmed, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
          c["id"].as_i64(),
          c["name"].as_str().unwrap_or(""),
          c["keywords"].as_str().unwrap_or("[]"),
          c["confirmed"].as_bool().unwrap_or(false),
          c["createdAt"].as_str().unwrap_or(""),
          c["updatedAt"].as_str().unwrap_or(""),
        ],
      )
      .map_err(|e| format!("Failed to import keyword cluster: {}", e))?;
        }
    }

    // Import suggestion_feedback
    if let Some(feedbacks) = data.get("suggestionFeedback").and_then(|v| v.as_array()) {
        for f in feedbacks {
            tx.execute(
        "INSERT INTO suggestion_feedback (id, task_id, task_title, project_id, suggestion_title, source, action, job_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
          f["id"].as_i64(),
          f["taskId"].as_i64(),
          f["taskTitle"].as_str().unwrap_or(""),
          f["projectId"].as_i64(),
          f["suggestionTitle"].as_str().unwrap_or(""),
          f["source"].as_str().unwrap_or("ai"),
          f["action"].as_str().unwrap_or("pending"),
          f["jobId"].as_i64(),
          f["createdAt"].as_str().unwrap_or(""),
        ],
      )
      .map_err(|e| format!("Failed to import suggestion feedback: {}", e))?;
        }
    }

    // Import task_subtask_history
    if let Some(histories) = data.get("taskSubtaskHistory").and_then(|v| v.as_array()) {
        for h in histories {
            tx.execute(
        "INSERT INTO task_subtask_history (id, parent_task_id, parent_title, project_id, subtask_titles, captured_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
          h["id"].as_i64(),
          h["parentTaskId"].as_i64(),
          h["parentTitle"].as_str().unwrap_or(""),
          h["projectId"].as_i64(),
          h["subtaskTitles"].as_str().unwrap_or("[]"),
          h["capturedAt"].as_str().unwrap_or(""),
        ],
      )
      .map_err(|e| format!("Failed to import task subtask history: {}", e))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit import: {}", e))?;

    Ok(())
}

// ── Export collector helpers ────────────────────────────────────────────────

fn collect_focus_session_segments(
    db: &rusqlite::Connection,
) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = db
    .prepare("SELECT id, session_id, task_id, start_time, duration_seconds, sort_order, created_at FROM focus_session_segments")
    .map_err(|e| e.to_string())?;
    let mapped_rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
              "id": row.get::<_, i64>(0)?,
              "sessionId": row.get::<_, i64>(1)?,
              "taskId": row.get::<_, Option<i64>>(2)?,
              "startTime": row.get::<_, String>(3)?,
              "durationSeconds": row.get::<_, i64>(4)?,
              "sortOrder": row.get::<_, i64>(5)?,
              "createdAt": row.get::<_, String>(6)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for row in mapped_rows {
        rows.push(row.map_err(|e| e.to_string())?);
    }
    Ok(rows)
}

fn collect_task_completion_logs(
    db: &rusqlite::Connection,
) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = db
    .prepare(
      "SELECT id, task_id, task_title, estimated_seconds, actual_seconds, deviation_percentage,
              deviation_reason, reflection, next_improvement, personal_notes, completed_at, created_at
       FROM task_completion_logs
       ORDER BY completed_at DESC, id DESC",
    )
    .map_err(|e| e.to_string())?;
    let mapped_rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
              "id": row.get::<_, i64>(0)?,
              "taskId": row.get::<_, i64>(1)?,
              "taskTitle": row.get::<_, String>(2)?,
              "estimatedSeconds": row.get::<_, i64>(3)?,
              "actualSeconds": row.get::<_, i64>(4)?,
              "deviationPercentage": row.get::<_, Option<f64>>(5)?,
              "deviationReason": row.get::<_, Option<String>>(6)?,
              "reflection": row.get::<_, Option<String>>(7)?,
              "nextImprovement": row.get::<_, Option<String>>(8)?,
              "personalNotes": row.get::<_, Option<String>>(9)?,
              "completedAt": row.get::<_, String>(10)?,
              "createdAt": row.get::<_, String>(11)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for row in mapped_rows {
        rows.push(row.map_err(|e| e.to_string())?);
    }
    Ok(rows)
}

fn collect_ai_skills(db: &rusqlite::Connection) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = db
    .prepare("SELECT id, key, name, description, system_prompt, user_prompt_template, action_types, trigger_type, is_builtin, enabled, created_at, updated_at FROM ai_skills")
    .map_err(|e| e.to_string())?;
    let mapped_rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
              "id": row.get::<_, i64>(0)?,
              "key": row.get::<_, String>(1)?,
              "name": row.get::<_, String>(2)?,
              "description": row.get::<_, String>(3)?,
              "systemPrompt": row.get::<_, String>(4)?,
              "userPromptTemplate": row.get::<_, String>(5)?,
              "actionTypes": row.get::<_, String>(6)?,
              "triggerType": row.get::<_, String>(7)?,
              "isBuiltin": row.get::<_, bool>(8)?,
              "enabled": row.get::<_, bool>(9)?,
              "createdAt": row.get::<_, String>(10)?,
              "updatedAt": row.get::<_, String>(11)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for row in mapped_rows {
        rows.push(row.map_err(|e| e.to_string())?);
    }
    Ok(rows)
}

fn collect_ai_jobs(db: &rusqlite::Connection) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = db
    .prepare("SELECT id, skill_id, status, input_context, raw_response, actions, error, created_at, completed_at FROM ai_jobs")
    .map_err(|e| e.to_string())?;
    let mapped_rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
              "id": row.get::<_, i64>(0)?,
              "skillId": row.get::<_, i64>(1)?,
              "status": row.get::<_, String>(2)?,
              "inputContext": row.get::<_, String>(3)?,
              "rawResponse": row.get::<_, Option<String>>(4)?,
              "actions": row.get::<_, Option<String>>(5)?,
              "error": row.get::<_, Option<String>>(6)?,
              "createdAt": row.get::<_, String>(7)?,
              "completedAt": row.get::<_, Option<String>>(8)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for row in mapped_rows {
        rows.push(row.map_err(|e| e.to_string())?);
    }
    Ok(rows)
}

fn collect_subtask_patterns(db: &rusqlite::Connection) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = db
    .prepare("SELECT id, name, keywords, subtasks, project_id, is_builtin, usage_count, created_at, updated_at FROM subtask_patterns")
    .map_err(|e| e.to_string())?;
    let mapped_rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
              "id": row.get::<_, i64>(0)?,
              "name": row.get::<_, String>(1)?,
              "keywords": row.get::<_, String>(2)?,
              "subtasks": row.get::<_, String>(3)?,
              "projectId": row.get::<_, Option<i64>>(4)?,
              "isBuiltin": row.get::<_, bool>(5)?,
              "usageCount": row.get::<_, i64>(6)?,
              "createdAt": row.get::<_, String>(7)?,
              "updatedAt": row.get::<_, String>(8)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for row in mapped_rows {
        rows.push(row.map_err(|e| e.to_string())?);
    }
    Ok(rows)
}

fn collect_subtask_learn_log(db: &rusqlite::Connection) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = db
    .prepare("SELECT id, cluster_id, project_id, keyword, subtask_title, score, source, last_used_at, created_at FROM subtask_learn_log")
    .map_err(|e| e.to_string())?;
    let mapped_rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
              "id": row.get::<_, i64>(0)?,
              "clusterId": row.get::<_, Option<i64>>(1)?,
              "projectId": row.get::<_, Option<i64>>(2)?,
              "keyword": row.get::<_, String>(3)?,
              "subtaskTitle": row.get::<_, String>(4)?,
              "score": row.get::<_, i64>(5)?,
              "source": row.get::<_, String>(6)?,
              "lastUsedAt": row.get::<_, String>(7)?,
              "createdAt": row.get::<_, String>(8)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for row in mapped_rows {
        rows.push(row.map_err(|e| e.to_string())?);
    }
    Ok(rows)
}

fn collect_keyword_clusters(db: &rusqlite::Connection) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = db
        .prepare(
            "SELECT id, name, keywords, confirmed, created_at, updated_at FROM keyword_clusters",
        )
        .map_err(|e| e.to_string())?;
    let mapped_rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
              "id": row.get::<_, i64>(0)?,
              "name": row.get::<_, String>(1)?,
              "keywords": row.get::<_, String>(2)?,
              "confirmed": row.get::<_, bool>(3)?,
              "createdAt": row.get::<_, String>(4)?,
              "updatedAt": row.get::<_, String>(5)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for row in mapped_rows {
        rows.push(row.map_err(|e| e.to_string())?);
    }
    Ok(rows)
}

fn collect_suggestion_feedback(
    db: &rusqlite::Connection,
) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = db
    .prepare("SELECT id, task_id, task_title, project_id, suggestion_title, source, action, job_id, created_at FROM suggestion_feedback")
    .map_err(|e| e.to_string())?;
    let mapped_rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
              "id": row.get::<_, i64>(0)?,
              "taskId": row.get::<_, i64>(1)?,
              "taskTitle": row.get::<_, String>(2)?,
              "projectId": row.get::<_, Option<i64>>(3)?,
              "suggestionTitle": row.get::<_, String>(4)?,
              "source": row.get::<_, String>(5)?,
              "action": row.get::<_, String>(6)?,
              "jobId": row.get::<_, Option<i64>>(7)?,
              "createdAt": row.get::<_, String>(8)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for row in mapped_rows {
        rows.push(row.map_err(|e| e.to_string())?);
    }
    Ok(rows)
}

fn collect_task_subtask_history(
    db: &rusqlite::Connection,
) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = db
    .prepare("SELECT id, parent_task_id, parent_title, project_id, subtask_titles, captured_at FROM task_subtask_history")
    .map_err(|e| e.to_string())?;
    let mapped_rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
              "id": row.get::<_, i64>(0)?,
              "parentTaskId": row.get::<_, i64>(1)?,
              "parentTitle": row.get::<_, String>(2)?,
              "projectId": row.get::<_, Option<i64>>(3)?,
              "subtaskTitles": row.get::<_, String>(4)?,
              "capturedAt": row.get::<_, String>(5)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for row in mapped_rows {
        rows.push(row.map_err(|e| e.to_string())?);
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::{generate_export_json_from_db, import_json_data_to_db};

    fn setup_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        let _ = crate::db::run_migrations(&conn);
        conn
    }

    fn seed_completed_task(
        conn: &rusqlite::Connection,
        task_id: i64,
        title: &str,
        completed_at: &str,
        actual_seconds: i64,
    ) {
        conn
      .execute(
        "INSERT INTO tasks (
           id, title, status, priority, project_id, parent_id, due_at, reminder_time,
           completed_at, deleted_at, notes, pomodoro_count, pomodoro_duration, sort_order,
           recurring_rule_id, start_at, created_at, updated_at
         ) VALUES (?1, ?2, 'done', 0, 1, NULL, NULL, NULL, ?3, NULL, NULL, 2, 25, 0, NULL, NULL, ?4, ?4)",
        rusqlite::params![task_id, title, completed_at, completed_at],
      )
      .expect("insert task");

        conn
      .execute(
        "INSERT INTO focus_sessions (
           id, task_id, start_time, end_time, duration_seconds, type, status, interruption_reason, pomodoro_count, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, 'focus', 'completed', NULL, 2, ?3)",
        rusqlite::params![
          task_id,
          task_id,
          "2026-03-20T09:00:00Z",
          "2026-03-20T10:00:00Z",
          actual_seconds,
        ],
      )
      .expect("insert focus session");
    }

    #[test]
    fn export_json_excludes_credentials() {
        let conn = setup_db();
        conn.execute_batch(
            "INSERT INTO user_settings (key, value) VALUES
               ('webdavPassword', 'secret'),
               ('aiApiKey', 'sk-test'),
               ('closeToTray', 'true');",
        )
        .expect("seed settings");

        let json = generate_export_json_from_db(&conn).expect("export");
        let data: serde_json::Value = serde_json::from_str(&json).expect("parse export");
        let keys: Vec<&str> = data["settings"]
            .as_array()
            .expect("settings array")
            .iter()
            .map(|s| s["key"].as_str().expect("setting key"))
            .collect();

        assert!(!keys.contains(&"webdavPassword"));
        assert!(!keys.contains(&"aiApiKey"));
        assert!(keys.contains(&"closeToTray"));
    }

    #[test]
    fn export_json_includes_task_completion_logs() {
        let conn = setup_db();
        seed_completed_task(&conn, 11, "补齐同步日志", "2026-03-20T10:00:00Z", 3300);

        conn
      .execute(
        "INSERT INTO task_completion_logs (
           id, task_id, task_title, estimated_seconds, actual_seconds, deviation_percentage, completed_at, created_at
         ) VALUES (1, 11, '补齐同步日志', 3000, 3300, 10.0, '2026-03-20T10:00:00Z', '2026-03-20T10:00:00Z')",
        [],
      )
      .expect("insert completion log");

        let json = generate_export_json_from_db(&conn).expect("export json");
        let data: serde_json::Value = serde_json::from_str(&json).expect("parse export");
        let logs = data["taskCompletionLogs"]
            .as_array()
            .expect("taskCompletionLogs array");

        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0]["taskId"].as_i64(), Some(11));
        assert_eq!(logs[0]["taskTitle"].as_str(), Some("补齐同步日志"));
        assert_eq!(logs[0]["actualSeconds"].as_i64(), Some(3300));
    }

    #[test]
    fn import_rejects_unsupported_version() {
        let source = setup_db();
        seed_completed_task(&source, 21, "版本校验", "2026-03-21T10:00:00Z", 3300);

        let export_json = generate_export_json_from_db(&source).expect("export json");
        let mut export_data: serde_json::Value =
            serde_json::from_str(&export_json).expect("parse export");

        let mut target = setup_db();

        // Missing version key → rejected
        export_data
            .as_object_mut()
            .expect("export object")
            .remove("version");
        let err = import_json_data_to_db(&mut target, &export_data)
            .expect_err("missing version must be rejected");
        assert!(err.contains("version 1"));

        // Wrong version → rejected
        export_data
            .as_object_mut()
            .expect("export object")
            .insert("version".into(), serde_json::json!(2));
        let err = import_json_data_to_db(&mut target, &export_data)
            .expect_err("wrong version must be rejected");
        assert!(err.contains("version 1"));
    }

    #[test]
    fn export_and_import_preserve_rescheduled_to() {
        let source = setup_db();
        source
            .execute(
                "INSERT INTO tasks (
                   id, title, status, priority, project_id, parent_id, due_at, reminder_time,
                   completed_at, deleted_at, notes, pomodoro_count, pomodoro_duration, sort_order,
                   recurring_rule_id, start_at, created_at, updated_at, rescheduled_to
                 ) VALUES (?1, ?2, 'cancelled', 0, 1, NULL, '2026-03-20', NULL, NULL, NULL, NULL, 1, 25, 0, NULL, NULL, ?3, ?3, '2026-03-22')",
                rusqlite::params![41, "延期任务", "2026-03-20T10:00:00Z"],
            )
            .expect("insert rescheduled task");

        let export_json = generate_export_json_from_db(&source).expect("export json");
        let export_data: serde_json::Value =
            serde_json::from_str(&export_json).expect("parse export");

        assert_eq!(
            export_data["tasks"][0]["rescheduledTo"].as_str(),
            Some("2026-03-22")
        );

        let mut target = setup_db();
        import_json_data_to_db(&mut target, &export_data).expect("import data");

        let rescheduled_to: Option<String> = target
            .query_row(
                "SELECT rescheduled_to FROM tasks WHERE id = 41",
                [],
                |row| row.get(0),
            )
            .expect("select rescheduled_to");

        assert_eq!(rescheduled_to.as_deref(), Some("2026-03-22"));
    }
}
