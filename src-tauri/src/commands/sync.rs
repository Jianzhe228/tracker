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
  let remote_str =
    String::from_utf8(remote_bytes).map_err(|e| format!("Invalid UTF-8 in remote data: {}", e))?;

  // Parse to verify it's valid JSON
  let remote_data: serde_json::Value =
    serde_json::from_str(&remote_str).map_err(|e| format!("Invalid JSON in remote data: {}", e))?;

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

  // Collect tasks
  let mut task_stmt = db
    .prepare("SELECT id, title, status, priority, project_id, parent_id, due_at, reminder_time, completed_at, deleted_at, notes, pomodoro_count, pomodoro_duration, sort_order, recurring_rule_id, created_at, updated_at FROM tasks")
    .map_err(|e| e.to_string())?;
  let tasks: Vec<serde_json::Value> = task_stmt
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
        "createdAt": row.get::<_, String>(15)?,
        "updatedAt": row.get::<_, String>(16)?,
      }))
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

  // Collect projects
  let mut proj_stmt = db
    .prepare("SELECT id, title, color, icon, parent_id, created_at, updated_at FROM projects")
    .map_err(|e| e.to_string())?;
  let projects: Vec<serde_json::Value> = proj_stmt
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
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

  // Collect focus_sessions
  let mut fs_stmt = db
    .prepare("SELECT id, task_id, start_time, end_time, duration_seconds, type, status, interruption_reason, pomodoro_count, created_at FROM focus_sessions")
    .map_err(|e| e.to_string())?;
  let focus_sessions: Vec<serde_json::Value> = fs_stmt
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
        "pomodoroCount": row.get::<_, i64>(8)?,
        "createdAt": row.get::<_, String>(9)?,
      }))
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

  // Collect settings
  let mut settings_stmt = db
    .prepare("SELECT key, value FROM user_settings")
    .map_err(|e| e.to_string())?;
  let settings: Vec<serde_json::Value> = settings_stmt
    .query_map([], |row| {
      Ok(serde_json::json!({
        "key": row.get::<_, String>(0)?,
        "value": row.get::<_, String>(1)?,
      }))
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

  // Collect recurring_rules
  let mut rr_stmt = db
    .prepare("SELECT id, title, description, priority, project_id, repeat_type, repeat_days, anchor_date, reminder_time, notes, pomodoro_count, pomodoro_duration, active, last_generated_date, created_at, updated_at FROM recurring_rules")
    .map_err(|e| e.to_string())?;
  let recurring_rules: Vec<serde_json::Value> = rr_stmt
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
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

  let export_data = serde_json::json!({
    "version": 1,
    "exportedAt": chrono::Utc::now().to_rfc3339(),
    "tasks": tasks,
    "projects": projects,
    "focusSessions": focus_sessions,
    "settings": settings,
    "recurringRules": recurring_rules,
  });

  serde_json::to_string_pretty(&export_data).map_err(|e| e.to_string())
}

/// Save a local backup JSON file before destructive operations.
fn save_local_backup(app_handle: &AppHandle, json_data: &str) -> Result<(), String> {
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
pub(crate) fn import_json_data(state: &State<'_, AppState>, data: &serde_json::Value) -> Result<(), String> {
  let mut db = state.db().lock().map_err(|e| e.to_string())?;
  let tx = db.transaction().map_err(|e| e.to_string())?;

  // Clear existing data
  tx.execute_batch(
    "
    DELETE FROM task_completion_logs;
    DELETE FROM task_deletion_logs;
    DELETE FROM focus_sessions;
    DELETE FROM notification_logs;
    DELETE FROM ai_logs;
    DELETE FROM daily_summaries;
    DELETE FROM task_tags;
    DELETE FROM tasks;
    DELETE FROM recurring_rules;
    DELETE FROM projects;
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
        "INSERT INTO tasks (id, title, status, priority, project_id, parent_id, due_at, reminder_time, completed_at, deleted_at, notes, pomodoro_count, pomodoro_duration, sort_order, recurring_rule_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
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
          t["createdAt"].as_str().unwrap_or(""),
          t["updatedAt"].as_str().unwrap_or(""),
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
          s["pomodoroCount"].as_i64().unwrap_or(0),
          s["createdAt"].as_str().unwrap_or(""),
        ],
      )
      .map_err(|e| format!("Failed to import focus session: {}", e))?;
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

  tx.commit()
    .map_err(|e| format!("Failed to commit import: {}", e))?;

  Ok(())
}
