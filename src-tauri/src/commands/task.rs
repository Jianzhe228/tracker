use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::AppState;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRow {
  pub id: i64,
  pub title: String,
  pub description: Option<String>,
  pub status: String,
  pub priority: i64,
  pub project_id: Option<i64>,
  pub parent_id: Option<i64>,
  pub due_at: Option<String>,
  pub reminder_time: Option<String>,
  pub completed_at: Option<String>,
  pub deleted_at: Option<String>,
  pub is_recurring: bool,
  pub repeat_rule: Option<String>,
  pub notes: Option<String>,
  pub pomodoro_count: i64,
  pub pomodoro_duration: i64,
  pub sort_order: i64,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCreatePayload {
  pub id: i64,
  pub title: String,
  pub description: Option<String>,
  pub priority: Option<i64>,
  pub project_id: Option<i64>,
  pub parent_id: Option<i64>,
  pub due_at: Option<String>,
  pub reminder_time: Option<String>,
  pub is_recurring: Option<bool>,
  pub repeat_rule: Option<String>,
  pub notes: Option<String>,
  pub pomodoro_count: Option<i64>,
  pub pomodoro_duration: Option<i64>,
  pub sort_order: Option<i64>,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUpdatePayload {
  pub id: i64,
  pub title: Option<String>,
  pub description: Option<Option<String>>,
  pub status: Option<String>,
  pub priority: Option<i64>,
  pub project_id: Option<Option<i64>>,
  pub parent_id: Option<Option<i64>>,
  pub due_at: Option<Option<String>>,
  pub reminder_time: Option<Option<String>>,
  pub completed_at: Option<Option<String>>,
  pub deleted_at: Option<Option<String>>,
  pub is_recurring: Option<bool>,
  pub repeat_rule: Option<Option<String>>,
  pub notes: Option<Option<String>>,
  pub pomodoro_count: Option<i64>,
  pub pomodoro_duration: Option<i64>,
  pub sort_order: Option<i64>,
  pub updated_at: String,
}

#[tauri::command]
pub fn task_list(state: State<'_, AppState>) -> Result<Vec<TaskRow>, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  let mut stmt = db
    .prepare(
      "SELECT id, title, description, status, priority, project_id, parent_id, due_at, reminder_time, completed_at, deleted_at, is_recurring, repeat_rule, notes, pomodoro_count, pomodoro_duration, sort_order, created_at, updated_at
       FROM tasks
       WHERE deleted_at IS NULL
       ORDER BY sort_order ASC, created_at DESC",
    )
    .map_err(|e| e.to_string())?;

  let rows = stmt
    .query_map([], |row| {
      Ok(TaskRow {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        status: row.get(3)?,
        priority: row.get(4)?,
        project_id: row.get(5)?,
        parent_id: row.get(6)?,
        due_at: row.get(7)?,
        reminder_time: row.get(8)?,
        completed_at: row.get(9)?,
        deleted_at: row.get(10)?,
        is_recurring: row.get::<_, i32>(11)? != 0,
        repeat_rule: row.get(12)?,
        notes: row.get(13)?,
        pomodoro_count: row.get(14)?,
        pomodoro_duration: row.get(15)?,
        sort_order: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
      })
    })
    .map_err(|e| e.to_string())?;

  let mut tasks = Vec::new();
  for row in rows {
    tasks.push(row.map_err(|e| e.to_string())?);
  }
  Ok(tasks)
}

#[tauri::command]
pub fn task_create(state: State<'_, AppState>, payload: TaskCreatePayload) -> Result<TaskRow, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;

  let priority = payload.priority.unwrap_or(0);
  let pomodoro_count = payload.pomodoro_count.unwrap_or(1);
  let pomodoro_duration = payload.pomodoro_duration.unwrap_or(25);
  let sort_order = payload.sort_order.unwrap_or(0);
  let is_recurring = payload.is_recurring.unwrap_or(false);

  db.execute(
    "INSERT INTO tasks (id, title, description, status, priority, project_id, parent_id, due_at, reminder_time, is_recurring, repeat_rule, notes, pomodoro_count, pomodoro_duration, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, 'todo', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
    rusqlite::params![
      payload.id,
      payload.title,
      payload.description,
      priority,
      payload.project_id,
      payload.parent_id,
      payload.due_at,
      payload.reminder_time,
      is_recurring as i32,
      payload.repeat_rule,
      payload.notes,
      pomodoro_count,
      pomodoro_duration,
      sort_order,
      payload.created_at,
      payload.updated_at,
    ],
  )
  .map_err(|e| e.to_string())?;

  Ok(TaskRow {
    id: payload.id,
    title: payload.title,
    description: payload.description,
    status: "todo".to_string(),
    priority,
    project_id: payload.project_id,
    parent_id: payload.parent_id,
    due_at: payload.due_at,
    reminder_time: payload.reminder_time,
    completed_at: None,
    deleted_at: None,
    is_recurring,
    repeat_rule: payload.repeat_rule,
    notes: payload.notes,
    pomodoro_count,
    pomodoro_duration,
    sort_order,
    created_at: payload.created_at,
    updated_at: payload.updated_at,
  })
}

#[tauri::command]
pub fn task_update(state: State<'_, AppState>, payload: TaskUpdatePayload) -> Result<(), String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;

  let mut sets = Vec::new();
  let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

  if let Some(ref title) = payload.title {
    sets.push("title = ?");
    params.push(Box::new(title.clone()));
  }
  if let Some(ref description) = payload.description {
    sets.push("description = ?");
    params.push(Box::new(description.clone()));
  }
  if let Some(ref status) = payload.status {
    sets.push("status = ?");
    params.push(Box::new(status.clone()));
  }
  if let Some(priority) = payload.priority {
    sets.push("priority = ?");
    params.push(Box::new(priority));
  }
  if let Some(ref project_id) = payload.project_id {
    sets.push("project_id = ?");
    params.push(Box::new(*project_id));
  }
  if let Some(ref parent_id) = payload.parent_id {
    sets.push("parent_id = ?");
    params.push(Box::new(*parent_id));
  }
  if let Some(ref due_at) = payload.due_at {
    sets.push("due_at = ?");
    params.push(Box::new(due_at.clone()));
  }
  if let Some(ref reminder_time) = payload.reminder_time {
    sets.push("reminder_time = ?");
    params.push(Box::new(reminder_time.clone()));
  }
  if let Some(ref completed_at) = payload.completed_at {
    sets.push("completed_at = ?");
    params.push(Box::new(completed_at.clone()));
  }
  if let Some(ref deleted_at) = payload.deleted_at {
    sets.push("deleted_at = ?");
    params.push(Box::new(deleted_at.clone()));
  }
  if let Some(is_recurring) = payload.is_recurring {
    sets.push("is_recurring = ?");
    params.push(Box::new(is_recurring as i32));
  }
  if let Some(ref repeat_rule) = payload.repeat_rule {
    sets.push("repeat_rule = ?");
    params.push(Box::new(repeat_rule.clone()));
  }
  if let Some(ref notes) = payload.notes {
    sets.push("notes = ?");
    params.push(Box::new(notes.clone()));
  }
  if let Some(pomodoro_count) = payload.pomodoro_count {
    sets.push("pomodoro_count = ?");
    params.push(Box::new(pomodoro_count));
  }
  if let Some(pomodoro_duration) = payload.pomodoro_duration {
    sets.push("pomodoro_duration = ?");
    params.push(Box::new(pomodoro_duration));
  }
  if let Some(sort_order) = payload.sort_order {
    sets.push("sort_order = ?");
    params.push(Box::new(sort_order));
  }

  sets.push("updated_at = ?");
  params.push(Box::new(payload.updated_at));

  params.push(Box::new(payload.id));

  let sql = format!("UPDATE tasks SET {} WHERE id = ?", sets.join(", "));
  let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
  db.execute(&sql, param_refs.as_slice())
    .map_err(|e| e.to_string())?;

  Ok(())
}

#[tauri::command]
pub fn task_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  let now = chrono::Utc::now().to_rfc3339();

  // Soft delete: set deleted_at
  db.execute(
    "UPDATE tasks SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
    rusqlite::params![now, id],
  )
  .map_err(|e| e.to_string())?;

  // Log deletion
  let title: String = db
    .query_row(
      "SELECT title FROM tasks WHERE id = ?1",
      rusqlite::params![id],
      |row| row.get(0),
    )
    .unwrap_or_else(|_| "Unknown".to_string());

  db.execute(
    "INSERT INTO task_deletion_logs (task_id, task_title, deleted_at) VALUES (?1, ?2, ?3)",
    rusqlite::params![id, title, now],
  )
  .map_err(|e| e.to_string())?;

  Ok(())
}
