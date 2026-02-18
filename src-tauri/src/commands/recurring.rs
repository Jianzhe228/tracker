use chrono::NaiveDate;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringRuleRow {
  pub id: i64,
  pub title: String,
  pub description: Option<String>,
  pub priority: i64,
  pub project_id: Option<i64>,
  pub repeat_type: String,
  pub repeat_days: Option<String>,
  pub anchor_date: String,
  pub reminder_time: Option<String>,
  pub notes: Option<String>,
  pub pomodoro_count: i64,
  pub pomodoro_duration: i64,
  pub active: bool,
  pub last_generated_date: Option<String>,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleCreatePayload {
  pub title: String,
  pub description: Option<String>,
  pub priority: Option<i64>,
  pub project_id: Option<i64>,
  pub repeat_type: String,
  pub repeat_days: Option<String>,
  pub anchor_date: String,
  pub reminder_time: Option<String>,
  pub notes: Option<String>,
  pub pomodoro_count: Option<i64>,
  pub pomodoro_duration: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleUpdatePayload {
  pub id: i64,
  pub title: Option<String>,
  pub description: Option<Option<String>>,
  pub priority: Option<i64>,
  pub project_id: Option<Option<i64>>,
  pub repeat_type: Option<String>,
  pub repeat_days: Option<Option<String>>,
  pub anchor_date: Option<String>,
  pub reminder_time: Option<Option<String>>,
  pub notes: Option<Option<String>>,
  pub pomodoro_count: Option<i64>,
  pub pomodoro_duration: Option<i64>,
}

#[derive(Debug)]
struct ExistingRule {
  title: String,
  repeat_type: String,
  repeat_days: Option<String>,
  anchor_date: String,
  priority: i64,
  pomodoro_count: i64,
  pomodoro_duration: i64,
}

fn validate_title(title: &str) -> Result<(), String> {
  let trimmed = title.trim();
  if trimmed.is_empty() {
    return Err("Rule title cannot be empty".to_string());
  }
  if trimmed.chars().count() > 100 {
    return Err("Rule title cannot exceed 100 characters".to_string());
  }
  Ok(())
}

fn validate_priority(priority: i64) -> Result<(), String> {
  if (0..=3).contains(&priority) {
    Ok(())
  } else {
    Err("Priority must be between 0 and 3".to_string())
  }
}

fn validate_pomodoro(pomodoro_count: i64, pomodoro_duration: i64) -> Result<(), String> {
  if pomodoro_count <= 0 {
    return Err("Pomodoro count must be greater than 0".to_string());
  }
  if pomodoro_duration <= 0 {
    return Err("Pomodoro duration must be greater than 0".to_string());
  }
  Ok(())
}

fn validate_repeat_type(repeat_type: &str) -> Result<(), String> {
  match repeat_type {
    "daily" | "weekdays" | "weekly" | "monthly" | "custom" => Ok(()),
    _ => Err("Invalid repeat type".to_string()),
  }
}

fn validate_anchor_date(anchor_date: &str) -> Result<(), String> {
  NaiveDate::parse_from_str(anchor_date, "%Y-%m-%d")
    .map_err(|_| "Anchor date must be in YYYY-MM-DD format".to_string())?;
  Ok(())
}

fn normalize_repeat_days(repeat_type: &str, repeat_days: Option<&str>) -> Result<Option<String>, String> {
  if repeat_type != "custom" {
    return Ok(None);
  }

  let raw = repeat_days.ok_or_else(|| "Custom repeat rule requires repeatDays".to_string())?;
  let body = raw
    .trim()
    .trim_start_matches('[')
    .trim_end_matches(']')
    .trim();

  if body.is_empty() {
    return Err("Custom repeat rule requires at least one weekday".to_string());
  }

  let mut days = Vec::new();
  for part in body.split(',') {
    let value = part
      .trim()
      .parse::<u32>()
      .map_err(|_| "repeatDays must contain numbers from 1 to 7".to_string())?;
    if !(1..=7).contains(&value) {
      return Err("repeatDays must contain numbers from 1 to 7".to_string());
    }
    days.push(value);
  }

  days.sort_unstable();
  days.dedup();

  if days.is_empty() {
    return Err("Custom repeat rule requires at least one weekday".to_string());
  }

  let normalized = format!(
    "[{}]",
    days
      .iter()
      .map(|day| day.to_string())
      .collect::<Vec<_>>()
      .join(",")
  );

  Ok(Some(normalized))
}

fn fetch_rule(conn: &rusqlite::Connection, id: i64) -> Result<RecurringRuleRow, String> {
  conn
    .query_row(
      "SELECT id, title, description, priority, project_id, repeat_type, repeat_days, anchor_date, reminder_time, notes, pomodoro_count, pomodoro_duration, active, last_generated_date, created_at, updated_at
       FROM recurring_rules
       WHERE id = ?1",
      rusqlite::params![id],
      |row| {
        Ok(RecurringRuleRow {
          id: row.get(0)?,
          title: row.get(1)?,
          description: row.get(2)?,
          priority: row.get(3)?,
          project_id: row.get(4)?,
          repeat_type: row.get(5)?,
          repeat_days: row.get(6)?,
          anchor_date: row.get(7)?,
          reminder_time: row.get(8)?,
          notes: row.get(9)?,
          pomodoro_count: row.get(10)?,
          pomodoro_duration: row.get(11)?,
          active: row.get::<_, i32>(12)? != 0,
          last_generated_date: row.get(13)?,
          created_at: row.get(14)?,
          updated_at: row.get(15)?,
        })
      },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn recurring_rule_create(
  state: State<'_, AppState>,
  payload: RuleCreatePayload,
) -> Result<RecurringRuleRow, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;

  let title = payload.title.trim().to_string();
  validate_title(&title)?;

  let priority = payload.priority.unwrap_or(0);
  let pomodoro_count = payload.pomodoro_count.unwrap_or(1);
  let pomodoro_duration = payload.pomodoro_duration.unwrap_or(25);
  let repeat_type = payload.repeat_type.trim().to_string();
  let anchor_date = payload.anchor_date.trim().to_string();

  validate_priority(priority)?;
  validate_pomodoro(pomodoro_count, pomodoro_duration)?;
  validate_repeat_type(&repeat_type)?;
  validate_anchor_date(&anchor_date)?;

  let repeat_days = normalize_repeat_days(&repeat_type, payload.repeat_days.as_deref())?;
  let now = chrono::Utc::now().to_rfc3339();

  db.execute(
    "INSERT INTO recurring_rules (
       title,
       description,
       priority,
       project_id,
       repeat_type,
       repeat_days,
       anchor_date,
       reminder_time,
       notes,
       pomodoro_count,
       pomodoro_duration,
       created_at,
       updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
    rusqlite::params![
      title,
      payload.description,
      priority,
      payload.project_id,
      repeat_type,
      repeat_days,
      anchor_date,
      payload.reminder_time,
      payload.notes,
      pomodoro_count,
      pomodoro_duration,
      now,
    ],
  )
  .map_err(|e| e.to_string())?;

  let id = db.last_insert_rowid();
  fetch_rule(&db, id)
}

#[tauri::command]
pub fn recurring_rule_update(
  state: State<'_, AppState>,
  payload: RuleUpdatePayload,
) -> Result<(), String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;

  let existing: ExistingRule = db
    .query_row(
      "SELECT title, repeat_type, repeat_days, anchor_date, priority, pomodoro_count, pomodoro_duration
       FROM recurring_rules
       WHERE id = ?1",
      rusqlite::params![payload.id],
      |row| {
        Ok(ExistingRule {
          title: row.get(0)?,
          repeat_type: row.get(1)?,
          repeat_days: row.get(2)?,
          anchor_date: row.get(3)?,
          priority: row.get(4)?,
          pomodoro_count: row.get(5)?,
          pomodoro_duration: row.get(6)?,
        })
      },
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Recurring rule not found".to_string())?;

  let next_title = payload
    .title
    .as_deref()
    .map(|value| value.trim().to_string())
    .unwrap_or_else(|| existing.title.clone());
  validate_title(&next_title)?;

  let next_repeat_type = payload
    .repeat_type
    .as_deref()
    .map(|value| value.trim().to_string())
    .unwrap_or_else(|| existing.repeat_type.clone());
  validate_repeat_type(&next_repeat_type)?;

  let next_anchor_date = payload
    .anchor_date
    .as_deref()
    .map(|value| value.trim().to_string())
    .unwrap_or_else(|| existing.anchor_date.clone());
  validate_anchor_date(&next_anchor_date)?;

  let next_priority = payload.priority.unwrap_or(existing.priority);
  validate_priority(next_priority)?;

  let next_pomodoro_count = payload.pomodoro_count.unwrap_or(existing.pomodoro_count);
  let next_pomodoro_duration = payload.pomodoro_duration.unwrap_or(existing.pomodoro_duration);
  validate_pomodoro(next_pomodoro_count, next_pomodoro_duration)?;

  let raw_repeat_days = payload
    .repeat_days
    .clone()
    .unwrap_or(existing.repeat_days.clone());
  let normalized_repeat_days = normalize_repeat_days(&next_repeat_type, raw_repeat_days.as_deref())?;

  let mut sets = Vec::new();
  let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

  if payload.title.is_some() {
    sets.push("title = ?");
    params.push(Box::new(next_title));
  }
  if let Some(ref description) = payload.description {
    sets.push("description = ?");
    params.push(Box::new(description.clone()));
  }
  if payload.priority.is_some() {
    sets.push("priority = ?");
    params.push(Box::new(next_priority));
  }
  if let Some(ref project_id) = payload.project_id {
    sets.push("project_id = ?");
    params.push(Box::new(*project_id));
  }
  if payload.repeat_type.is_some() {
    sets.push("repeat_type = ?");
    params.push(Box::new(next_repeat_type));
  }
  if payload.repeat_type.is_some() || payload.repeat_days.is_some() {
    sets.push("repeat_days = ?");
    params.push(Box::new(normalized_repeat_days));
  }
  if payload.anchor_date.is_some() {
    sets.push("anchor_date = ?");
    params.push(Box::new(next_anchor_date));
  }
  if let Some(ref reminder_time) = payload.reminder_time {
    sets.push("reminder_time = ?");
    params.push(Box::new(reminder_time.clone()));
  }
  if let Some(ref notes) = payload.notes {
    sets.push("notes = ?");
    params.push(Box::new(notes.clone()));
  }
  if payload.pomodoro_count.is_some() {
    sets.push("pomodoro_count = ?");
    params.push(Box::new(next_pomodoro_count));
  }
  if payload.pomodoro_duration.is_some() {
    sets.push("pomodoro_duration = ?");
    params.push(Box::new(next_pomodoro_duration));
  }

  if sets.is_empty() {
    return Ok(());
  }

  sets.push("updated_at = ?");
  params.push(Box::new(chrono::Utc::now().to_rfc3339()));
  params.push(Box::new(payload.id));

  let sql = format!(
    "UPDATE recurring_rules SET {} WHERE id = ?",
    sets.join(", ")
  );
  let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
  db.execute(&sql, param_refs.as_slice())
    .map_err(|e| e.to_string())?;

  Ok(())
}

#[tauri::command]
pub fn recurring_rule_deactivate(state: State<'_, AppState>, id: i64) -> Result<(), String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  db.execute(
    "UPDATE recurring_rules SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
    rusqlite::params![id],
  )
  .map_err(|e| e.to_string())?;
  Ok(())
}
