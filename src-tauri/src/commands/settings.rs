use serde::Serialize;
use tauri::State;

use crate::db::AppState;

#[derive(Debug, Serialize)]
pub struct SettingEntry {
  pub key: String,
  pub value: String,
}

#[tauri::command]
pub fn settings_get_all(state: State<'_, AppState>) -> Result<Vec<SettingEntry>, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  let mut stmt = db
    .prepare("SELECT key, value FROM user_settings")
    .map_err(|e| e.to_string())?;

  let rows = stmt
    .query_map([], |row| {
      Ok(SettingEntry {
        key: row.get(0)?,
        value: row.get(1)?,
      })
    })
    .map_err(|e| e.to_string())?;

  let mut entries = Vec::new();
  for row in rows {
    entries.push(row.map_err(|e| e.to_string())?);
  }
  Ok(entries)
}

#[tauri::command]
pub fn settings_set(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  db.execute(
    "INSERT INTO user_settings (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
    rusqlite::params![key, value],
  )
  .map_err(|e| e.to_string())?;
  Ok(())
}
