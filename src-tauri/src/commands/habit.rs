use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::AppState;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitRow {
  pub id: i64,
  pub title: String,
  pub description: Option<String>,
  pub icon: Option<String>,
  pub color: Option<String>,
  #[serde(rename = "type")]
  pub habit_type: String,
  pub target_value: i64,
  pub target_unit: Option<String>,
  pub frequency_type: String,
  pub frequency_value: Option<i64>,
  pub frequency_days: Option<String>,
  pub max_skips_per_month: i64,
  pub reminder_enabled: bool,
  pub reminder_time: Option<String>,
  pub archived: bool,
  pub checked_today: bool,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitCreatePayload {
  pub id: i64,
  pub title: String,
  pub description: Option<String>,
  pub icon: Option<String>,
  pub color: Option<String>,
  #[serde(rename = "type")]
  pub habit_type: Option<String>,
  pub target_value: Option<i64>,
  pub target_unit: Option<String>,
  pub frequency_type: Option<String>,
  pub frequency_value: Option<i64>,
  pub frequency_days: Option<String>,
}

fn today_str() -> String {
  chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn query_habits(db: &rusqlite::Connection, today: &str) -> Result<Vec<HabitRow>, String> {
  let mut stmt = db
    .prepare(
      "SELECT h.id, h.title, h.description, h.icon, h.color, h.type, h.target_value, h.target_unit, h.frequency_type, h.frequency_value, h.frequency_days, h.max_skips_per_month, h.reminder_enabled, h.reminder_time, h.archived, h.created_at, h.updated_at,
              CASE WHEN hl.id IS NOT NULL THEN 1 ELSE 0 END AS checked_today
       FROM habits h
       LEFT JOIN habit_logs hl ON hl.habit_id = h.id AND hl.check_in_date = ?1 AND hl.status = 'completed'
       WHERE h.archived = 0
       ORDER BY h.created_at DESC",
    )
    .map_err(|e| e.to_string())?;

  let rows = stmt
    .query_map(rusqlite::params![today], |row| {
      Ok(HabitRow {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        icon: row.get(3)?,
        color: row.get(4)?,
        habit_type: row.get(5)?,
        target_value: row.get(6)?,
        target_unit: row.get(7)?,
        frequency_type: row.get(8)?,
        frequency_value: row.get(9)?,
        frequency_days: row.get(10)?,
        max_skips_per_month: row.get(11)?,
        reminder_enabled: row.get::<_, i32>(12)? != 0,
        reminder_time: row.get(13)?,
        archived: row.get::<_, i32>(14)? != 0,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
        checked_today: row.get::<_, i32>(17)? != 0,
      })
    })
    .map_err(|e| e.to_string())?;

  let mut habits = Vec::new();
  for row in rows {
    habits.push(row.map_err(|e| e.to_string())?);
  }
  Ok(habits)
}

#[tauri::command]
pub fn habit_list(state: State<'_, AppState>) -> Result<Vec<HabitRow>, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  let today = today_str();
  query_habits(&db, &today)
}

#[tauri::command]
pub fn habit_create(state: State<'_, AppState>, payload: HabitCreatePayload) -> Result<HabitRow, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  let now = chrono::Utc::now().to_rfc3339();

  let habit_type = payload.habit_type.as_deref().unwrap_or("boolean");
  let target_value = payload.target_value.unwrap_or(1);
  let frequency_type = payload.frequency_type.as_deref().unwrap_or("daily");

  db.execute(
    "INSERT INTO habits (id, title, description, icon, color, type, target_value, target_unit, frequency_type, frequency_value, frequency_days, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
    rusqlite::params![
      payload.id,
      payload.title,
      payload.description,
      payload.icon,
      payload.color,
      habit_type,
      target_value,
      payload.target_unit,
      frequency_type,
      payload.frequency_value,
      payload.frequency_days,
      now,
      now,
    ],
  )
  .map_err(|e| e.to_string())?;

  Ok(HabitRow {
    id: payload.id,
    title: payload.title,
    description: payload.description,
    icon: payload.icon,
    color: payload.color,
    habit_type: habit_type.to_string(),
    target_value,
    target_unit: payload.target_unit,
    frequency_type: frequency_type.to_string(),
    frequency_value: payload.frequency_value,
    frequency_days: payload.frequency_days,
    max_skips_per_month: 3,
    reminder_enabled: false,
    reminder_time: None,
    archived: false,
    checked_today: false,
    created_at: now.clone(),
    updated_at: now,
  })
}

#[tauri::command]
pub fn habit_toggle_check(state: State<'_, AppState>, id: i64) -> Result<bool, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  let today = today_str();
  let now = chrono::Utc::now().to_rfc3339();

  // Check if already checked today
  let exists: bool = db
    .query_row(
      "SELECT COUNT(*) FROM habit_logs WHERE habit_id = ?1 AND check_in_date = ?2 AND status = 'completed'",
      rusqlite::params![id, today],
      |row| row.get::<_, i32>(0).map(|c| c > 0),
    )
    .map_err(|e| e.to_string())?;

  if exists {
    db.execute(
      "DELETE FROM habit_logs WHERE habit_id = ?1 AND check_in_date = ?2",
      rusqlite::params![id, today],
    )
    .map_err(|e| e.to_string())?;
    Ok(false) // now unchecked
  } else {
    db.execute(
      "INSERT OR REPLACE INTO habit_logs (habit_id, check_in_date, status, value, created_at) VALUES (?1, ?2, 'completed', 1, ?3)",
      rusqlite::params![id, today, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(true) // now checked
  }
}

#[tauri::command]
pub fn habit_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  db.execute("DELETE FROM habits WHERE id = ?1", rusqlite::params![id])
    .map_err(|e| e.to_string())?;
  Ok(())
}
