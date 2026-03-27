use chrono::{DateTime, Duration, Utc};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::AppState;

const MAX_SUBTASKS_PER_TASK: i64 = 50;
const MAX_TASK_DEPTH: i64 = 10;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRow {
  pub id: i64,
  pub title: String,
  pub status: String,
  pub priority: i64,
  pub project_id: Option<i64>,
  pub parent_id: Option<i64>,
  pub due_at: Option<String>,
  pub start_at: Option<String>,
  pub reminder_time: Option<String>,
  pub completed_at: Option<String>,
  pub deleted_at: Option<String>,
  pub notes: Option<String>,
  pub pomodoro_count: i64,
  pub pomodoro_duration: i64,
  pub sort_order: i64,
  pub recurring_rule_id: Option<i64>,
  pub created_at: String,
  pub updated_at: String,
  pub rescheduled_to: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCreatePayload {
  pub id: i64,
  pub title: String,
  pub priority: Option<i64>,
  pub project_id: Option<i64>,
  pub parent_id: Option<i64>,
  pub due_at: Option<String>,
  pub start_at: Option<String>,
  pub reminder_time: Option<String>,
  pub notes: Option<String>,
  pub pomodoro_count: Option<i64>,
  pub pomodoro_duration: Option<i64>,
  pub sort_order: Option<i64>,
  pub recurring_rule_id: Option<i64>,
  pub rescheduled_to: Option<String>,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUpdatePayload {
  pub id: i64,
  pub title: Option<String>,
  pub status: Option<String>,
  pub priority: Option<i64>,
  pub project_id: Option<Option<i64>>,
  pub parent_id: Option<Option<i64>>,
  pub due_at: Option<Option<String>>,
  pub start_at: Option<Option<String>>,
  pub reminder_time: Option<Option<String>>,
  pub completed_at: Option<Option<String>>,
  pub deleted_at: Option<Option<String>>,
  pub notes: Option<Option<String>>,
  pub pomodoro_count: Option<i64>,
  pub pomodoro_duration: Option<i64>,
  pub sort_order: Option<i64>,
  pub recurring_rule_id: Option<Option<i64>>,
  pub rescheduled_to: Option<Option<String>>,
  pub updated_at: String,
}

pub(crate) fn cleanup_expired_soft_deleted_tasks(conn: &Connection) -> Result<(), String> {
  // Use range query instead of julianday() function to allow index usage
  conn
    .execute(
      "DELETE FROM tasks
       WHERE deleted_at IS NOT NULL
         AND deleted_at <= datetime('now', '-10 seconds')",
      [],
    )
    .map_err(|e| e.to_string())?;
  Ok(())
}

fn validate_status(status: &str) -> Result<(), String> {
  match status {
    "todo" | "in_progress" | "done" | "cancelled" => Ok(()),
    _ => Err("Invalid task status".to_string()),
  }
}

fn validate_priority(priority: i64) -> Result<(), String> {
  if (0..=3).contains(&priority) {
    Ok(())
  } else {
    Err("Priority must be between 0 and 3".to_string())
  }
}

fn validate_pomodoro_fields(pomodoro_count: i64, pomodoro_duration: i64) -> Result<(), String> {
  if pomodoro_count <= 0 {
    return Err("Pomodoro count must be greater than 0".to_string());
  }
  if pomodoro_duration <= 0 {
    return Err("Pomodoro duration must be greater than 0".to_string());
  }
  Ok(())
}

fn validate_title(title: &str) -> Result<(), String> {
  let trimmed = title.trim();
  if trimmed.is_empty() {
    return Err("Task title cannot be empty".to_string());
  }
  if trimmed.chars().count() > 100 {
    return Err("Task title cannot exceed 100 characters".to_string());
  }
  Ok(())
}

/// Returns how many ancestors the given task has (0 = root task).
fn get_ancestor_depth(conn: &Connection, task_id: i64) -> Result<i64, String> {
  conn
    .query_row(
      "WITH RECURSIVE ancestors(id, parent_id, depth) AS (
         SELECT id, parent_id, 0 FROM tasks WHERE id = ?1 AND deleted_at IS NULL
         UNION ALL
         SELECT t.id, t.parent_id, a.depth + 1
         FROM tasks t JOIN ancestors a ON t.id = a.parent_id
         WHERE t.deleted_at IS NULL
       )
       SELECT COALESCE(MAX(depth), 0) FROM ancestors",
      rusqlite::params![task_id],
      |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

/// Returns the maximum depth of the subtree rooted at the given task (0 = leaf).
fn get_subtree_max_depth(conn: &Connection, task_id: i64) -> Result<i64, String> {
  conn
    .query_row(
      "WITH RECURSIVE subtree(id, depth) AS (
         SELECT id, 0 FROM tasks WHERE id = ?1 AND deleted_at IS NULL
         UNION ALL
         SELECT t.id, s.depth + 1
         FROM tasks t JOIN subtree s ON t.parent_id = s.id
         WHERE t.deleted_at IS NULL
       )
       SELECT COALESCE(MAX(depth), 0) FROM subtree",
      rusqlite::params![task_id],
      |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn validate_parent_assignment(
  conn: &Connection,
  task_id: Option<i64>,
  parent_id: i64,
) -> Result<(), String> {
  if let Some(id) = task_id {
    if id == parent_id {
      return Err("Task cannot be its own parent".to_string());
    }
  }

  // Verify parent exists
  let _parent_exists: bool = conn
    .query_row(
      "SELECT COUNT(*) > 0 FROM tasks WHERE id = ?1 AND deleted_at IS NULL",
      rusqlite::params![parent_id],
      |row| row.get(0),
    )
    .map_err(|e| e.to_string())?;

  if !_parent_exists {
    return Err("Parent task does not exist".to_string());
  }

  // Prevent circular reference: ensure parent_id is not a descendant of task_id
  if let Some(id) = task_id {
    let is_descendant: bool = conn
      .query_row(
        "WITH RECURSIVE subtree(id) AS (
           SELECT id FROM tasks WHERE id = ?1 AND deleted_at IS NULL
           UNION ALL
           SELECT t.id FROM tasks t JOIN subtree s ON t.parent_id = s.id
           WHERE t.deleted_at IS NULL
         )
         SELECT COUNT(*) > 0 FROM subtree WHERE id = ?2",
        rusqlite::params![id, parent_id],
        |row| row.get(0),
      )
      .map_err(|e| e.to_string())?;

    if is_descendant {
      return Err("Cannot create circular parent reference".to_string());
    }
  }

  // Check depth: parent's ancestor depth + 1 (for the child) must be < MAX_TASK_DEPTH
  let parent_depth = get_ancestor_depth(conn, parent_id)?;

  if let Some(id) = task_id {
    // Moving an existing task (which may have its own subtree) under parent_id
    let subtree_depth = get_subtree_max_depth(conn, id)?;
    // Total depth = parent's depth from root + 1 (for this task) + its subtree depth
    if parent_depth + 1 + subtree_depth >= MAX_TASK_DEPTH {
      return Err(format!(
        "Maximum nesting depth is {} levels",
        MAX_TASK_DEPTH
      ));
    }
  } else {
    // Creating a new task (leaf) under parent_id
    if parent_depth + 1 >= MAX_TASK_DEPTH {
      return Err(format!(
        "Maximum nesting depth is {} levels",
        MAX_TASK_DEPTH
      ));
    }
  }

  let sibling_count: i64 = if let Some(id) = task_id {
    conn
      .query_row(
        "SELECT COUNT(*)
         FROM tasks
         WHERE parent_id = ?1
           AND deleted_at IS NULL
           AND id != ?2",
        rusqlite::params![parent_id, id],
        |row| row.get(0),
      )
      .map_err(|e| e.to_string())?
  } else {
    conn
      .query_row(
        "SELECT COUNT(*) FROM tasks WHERE parent_id = ?1 AND deleted_at IS NULL",
        rusqlite::params![parent_id],
        |row| row.get(0),
      )
      .map_err(|e| e.to_string())?
  };

  if sibling_count >= MAX_SUBTASKS_PER_TASK {
    return Err(format!(
      "Each task can have at most {} subtasks",
      MAX_SUBTASKS_PER_TASK
    ));
  }

  Ok(())
}

fn ensure_due_at_for_recurring(
  recurring_rule_id: Option<i64>,
  due_at: Option<&str>,
) -> Result<(), String> {
  if recurring_rule_id.is_some() && due_at.is_none() {
    return Err("Recurring task must set dueAt".to_string());
  }
  Ok(())
}

fn has_incomplete_direct_subtasks(conn: &Connection, parent_id: i64) -> Result<bool, String> {
  conn
    .query_row(
      "SELECT COUNT(*) > 0
       FROM tasks
       WHERE parent_id = ?1
         AND deleted_at IS NULL
         AND status NOT IN ('done', 'cancelled')",
      rusqlite::params![parent_id],
      |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn insert_completion_log(
  tx: &rusqlite::Transaction<'_>,
  task_id: i64,
  completed_at: &str,
) -> Result<(), String> {
  let task_row: Option<(String, i64, i64, Option<i64>)> = tx
    .query_row(
      "SELECT title, pomodoro_count, pomodoro_duration, project_id FROM tasks WHERE id = ?1",
      rusqlite::params![task_id],
      |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )
    .optional()
    .map_err(|e| e.to_string())?;

  let Some((title, pomodoro_count, pomodoro_duration, project_id)) = task_row else {
    return Ok(());
  };

  let estimated_seconds = pomodoro_count.saturating_mul(pomodoro_duration).saturating_mul(60);
  if estimated_seconds <= 0 {
    return Ok(());
  }

  let actual_seconds: i64 = tx
    .query_row(
      "SELECT COALESCE(SUM(duration_seconds), 0)
       FROM focus_sessions
       WHERE task_id = ?1
         AND status = 'completed'
         AND type = 'focus'",
      rusqlite::params![task_id],
      |row| row.get(0),
    )
    .map_err(|e| e.to_string())?;

  let deviation_percentage = ((actual_seconds - estimated_seconds).abs() as f64 / estimated_seconds as f64) * 100.0;

  tx
    .execute(
      "INSERT INTO task_completion_logs (
         task_id,
         task_title,
         estimated_seconds,
         actual_seconds,
         deviation_percentage,
         completed_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      rusqlite::params![
        task_id,
        title,
        estimated_seconds,
        actual_seconds,
        deviation_percentage,
        completed_at,
      ],
    )
    .map_err(|e| e.to_string())?;

  // Snapshot subtask titles for learning
  capture_subtask_history(tx, task_id, &title, project_id)?;

  Ok(())
}

/// Snapshot direct subtask titles when a parent task is completed.
fn capture_subtask_history(
  tx: &rusqlite::Transaction<'_>,
  parent_id: i64,
  parent_title: &str,
  project_id: Option<i64>,
) -> Result<(), String> {
  let mut stmt = tx
    .prepare(
      "SELECT title FROM tasks
       WHERE parent_id = ?1 AND deleted_at IS NULL
       ORDER BY sort_order ASC, created_at ASC",
    )
    .map_err(|e| e.to_string())?;

  let rows = stmt
    .query_map(rusqlite::params![parent_id], |row| row.get::<_, String>(0))
    .map_err(|e| e.to_string())?;

  let mut titles = Vec::new();
  for row in rows {
    titles.push(row.map_err(|e| e.to_string())?);
  }

  if titles.is_empty() {
    return Ok(());
  }

  let titles_json = serde_json::to_string(&titles).map_err(|e| e.to_string())?;

  tx.execute(
    "INSERT INTO task_subtask_history (parent_task_id, parent_title, project_id, subtask_titles)
     VALUES (?1, ?2, ?3, ?4)",
    rusqlite::params![parent_id, parent_title, project_id, titles_json],
  )
  .map_err(|e| e.to_string())?;

  Ok(())
}

#[tauri::command]
pub fn task_list(state: State<'_, AppState>, limit: Option<i64>, offset: Option<i64>) -> Result<Vec<TaskRow>, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;

  let limit_val = limit.unwrap_or(5000);
  let offset_val = offset.unwrap_or(0);

  let mut stmt = db
    .prepare(
      "SELECT id, title, status, priority, project_id, parent_id, due_at, start_at, reminder_time, completed_at, deleted_at, notes, pomodoro_count, pomodoro_duration, sort_order, recurring_rule_id, created_at, updated_at, rescheduled_to
       FROM tasks
       WHERE deleted_at IS NULL
       ORDER BY sort_order ASC, created_at DESC
       LIMIT ?1 OFFSET ?2",
    )
    .map_err(|e| e.to_string())?;

  let rows = stmt
    .query_map(rusqlite::params![limit_val, offset_val], |row| {
      Ok(TaskRow {
        id: row.get(0)?,
        title: row.get(1)?,
        status: row.get(2)?,
        priority: row.get(3)?,
        project_id: row.get(4)?,
        parent_id: row.get(5)?,
        due_at: row.get(6)?,
        start_at: row.get(7)?,
        reminder_time: row.get(8)?,
        completed_at: row.get(9)?,
        deleted_at: row.get(10)?,
        notes: row.get(11)?,
        pomodoro_count: row.get(12)?,
        pomodoro_duration: row.get(13)?,
        sort_order: row.get(14)?,
        recurring_rule_id: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
        rescheduled_to: row.get(18)?,
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

  let title = payload.title.trim().to_string();
  validate_title(&title)?;

  let priority = payload.priority.unwrap_or(0);
  let pomodoro_count = payload.pomodoro_count.unwrap_or(1);
  let pomodoro_duration = payload.pomodoro_duration.unwrap_or(25);
  let sort_order = payload.sort_order.unwrap_or(0);

  validate_priority(priority)?;
  validate_pomodoro_fields(pomodoro_count, pomodoro_duration)?;

  if let Some(parent_id) = payload.parent_id {
    validate_parent_assignment(&db, None, parent_id)?;
  }

  ensure_due_at_for_recurring(payload.recurring_rule_id, payload.due_at.as_deref())?;

  db.execute(
    "INSERT INTO tasks (id, title, status, priority, project_id, parent_id, due_at, start_at, reminder_time, notes, pomodoro_count, pomodoro_duration, sort_order, recurring_rule_id, rescheduled_to, created_at, updated_at) VALUES (?1, ?2, 'todo', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
    rusqlite::params![
      payload.id,
      title,
      priority,
      payload.project_id,
      payload.parent_id,
      payload.due_at,
      payload.start_at,
      payload.reminder_time,
      payload.notes,
      pomodoro_count,
      pomodoro_duration,
      sort_order,
      payload.recurring_rule_id,
      payload.rescheduled_to,
      payload.created_at,
      payload.updated_at,
    ],
  )
  .map_err(|e| e.to_string())?;

  Ok(TaskRow {
    id: payload.id,
    title,
    status: "todo".to_string(),
    priority,
    project_id: payload.project_id,
    parent_id: payload.parent_id,
    due_at: payload.due_at,
    start_at: payload.start_at,
    reminder_time: payload.reminder_time,
    completed_at: None,
    deleted_at: None,
    notes: payload.notes,
    pomodoro_count,
    pomodoro_duration,
    sort_order,
    recurring_rule_id: payload.recurring_rule_id,
    rescheduled_to: payload.rescheduled_to,
    created_at: payload.created_at,
    updated_at: payload.updated_at,
  })
}

#[tauri::command]
pub fn task_update(state: State<'_, AppState>, payload: TaskUpdatePayload) -> Result<(), String> {
  let mut db = state.db().lock().map_err(|e| e.to_string())?;

  if let Some(ref title) = payload.title {
    validate_title(title)?;
  }
  if let Some(ref status) = payload.status {
    validate_status(status)?;
  }
  if let Some(priority) = payload.priority {
    validate_priority(priority)?;
  }

  let current_task: Option<(Option<String>, Option<i64>, String, Option<i64>)> = db
    .query_row(
      "SELECT due_at, recurring_rule_id, status, parent_id
       FROM tasks
       WHERE id = ?1 AND deleted_at IS NULL",
      rusqlite::params![payload.id],
      |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )
    .optional()
    .map_err(|e| e.to_string())?;

  let Some((current_due_at, current_recurring_rule_id, current_status, current_parent_id)) = current_task else {
    return Err("Task not found".to_string());
  };

  let next_due_at = payload.due_at.clone().unwrap_or(current_due_at);

  let next_recurring_rule_id = match payload.recurring_rule_id {
    Some(recurring_rule_id) => recurring_rule_id,
    None => current_recurring_rule_id,
  };

  ensure_due_at_for_recurring(next_recurring_rule_id, next_due_at.as_deref())?;

  if let Some(pomodoro_count) = payload.pomodoro_count {
    let next_duration = payload
      .pomodoro_duration
      .or_else(|| {
        db.query_row(
          "SELECT pomodoro_duration FROM tasks WHERE id = ?1",
          rusqlite::params![payload.id],
          |row| row.get::<_, i64>(0),
        )
        .ok()
      })
      .unwrap_or(25);
    validate_pomodoro_fields(pomodoro_count, next_duration)?;
  }

  if let Some(pomodoro_duration) = payload.pomodoro_duration {
    let next_count = payload
      .pomodoro_count
      .or_else(|| {
        db.query_row(
          "SELECT pomodoro_count FROM tasks WHERE id = ?1",
          rusqlite::params![payload.id],
          |row| row.get::<_, i64>(0),
        )
        .ok()
      })
      .unwrap_or(1);
    validate_pomodoro_fields(next_count, pomodoro_duration)?;
  }

  if let Some(Some(parent_id)) = payload.parent_id {
    validate_parent_assignment(&db, Some(payload.id), parent_id)?;
  }

  if payload.status.as_deref() == Some("done") && has_incomplete_direct_subtasks(&db, payload.id)? {
    return Err("Cannot complete task with unfinished subtasks".to_string());
  }

  let mark_as_done = payload.status.as_deref() == Some("done");
  let mark_as_not_done = payload.status.as_deref().is_some_and(|status| status != "done");
  let should_insert_completion_log = mark_as_done && current_status != "done" && current_status != "cancelled";

  let task_id = payload.id;
  let updated_at = payload.updated_at.clone();

  let mut sets = Vec::new();
  let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

  if let Some(ref title) = payload.title {
    sets.push("title = ?");
    params.push(Box::new(title.trim().to_string()));
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
  if let Some(ref start_at) = payload.start_at {
    sets.push("start_at = ?");
    params.push(Box::new(start_at.clone()));
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
  if let Some(ref recurring_rule_id) = payload.recurring_rule_id {
    sets.push("recurring_rule_id = ?");
    params.push(Box::new(*recurring_rule_id));
  }
  if let Some(ref rescheduled_to) = payload.rescheduled_to {
    sets.push("rescheduled_to = ?");
    params.push(Box::new(rescheduled_to.clone()));
  }

  sets.push("updated_at = ?");
  params.push(Box::new(payload.updated_at));

  params.push(Box::new(payload.id));

  let sql = format!("UPDATE tasks SET {} WHERE id = ?", sets.join(", "));
  let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

  if should_insert_completion_log || (mark_as_not_done && current_parent_id.is_some()) {
    let tx = db.transaction().map_err(|e| e.to_string())?;

    tx.execute(&sql, param_refs.as_slice())
      .map_err(|e| e.to_string())?;

    if should_insert_completion_log {
      insert_completion_log(&tx, task_id, &updated_at)?;
    }

    if mark_as_not_done {
      if current_parent_id.is_some() {
        tx.execute(
          "WITH RECURSIVE ancestors(id) AS (
             SELECT parent_id FROM tasks WHERE id = ?1 AND deleted_at IS NULL AND parent_id IS NOT NULL
             UNION ALL
             SELECT t.parent_id FROM tasks t JOIN ancestors a ON t.id = a.id
             WHERE t.parent_id IS NOT NULL AND t.deleted_at IS NULL
           )
           UPDATE tasks SET status = 'todo', completed_at = NULL, updated_at = ?2
           WHERE id IN (SELECT id FROM ancestors) AND status = 'done' AND deleted_at IS NULL",
          rusqlite::params![task_id, updated_at],
        )
        .map_err(|e| e.to_string())?;
      }
    }

    tx.commit().map_err(|e| e.to_string())?;
  } else {
    db.execute(&sql, param_refs.as_slice())
      .map_err(|e| e.to_string())?;
  }

  Ok(())
}

#[tauri::command]
pub fn task_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
  let mut db = state.db().lock().map_err(|e| e.to_string())?;
  cleanup_expired_soft_deleted_tasks(&db)?;

  let exists: bool = db
    .query_row(
      "SELECT COUNT(*) > 0 FROM tasks WHERE id = ?1 AND deleted_at IS NULL",
      rusqlite::params![id],
      |row| row.get(0),
    )
    .map_err(|e| e.to_string())?;

  if !exists {
    return Err("Task not found".to_string());
  }

  let now = Utc::now().to_rfc3339();
  let tx = db.transaction().map_err(|e| e.to_string())?;

  // Log all nodes in the subtree (parent + descendants).
  tx.execute(
    "WITH RECURSIVE subtree(id) AS (
       SELECT id FROM tasks WHERE id = ?1
       UNION ALL
       SELECT t.id
       FROM tasks t
       JOIN subtree s ON t.parent_id = s.id
       WHERE t.deleted_at IS NULL
     )
     INSERT INTO task_deletion_logs (task_id, task_title, deleted_at)
     SELECT id, title, ?2 FROM tasks WHERE id IN (SELECT id FROM subtree)",
    rusqlite::params![id, now.clone()],
  )
  .map_err(|e| e.to_string())?;

  // Soft delete the whole subtree so subtasks are hidden immediately.
  tx.execute(
    "WITH RECURSIVE subtree(id) AS (
       SELECT id FROM tasks WHERE id = ?1
       UNION ALL
       SELECT t.id
       FROM tasks t
       JOIN subtree s ON t.parent_id = s.id
       WHERE t.deleted_at IS NULL
     )
     UPDATE tasks
     SET deleted_at = ?2, updated_at = ?2
     WHERE id IN (SELECT id FROM subtree)",
    rusqlite::params![id, now],
  )
  .map_err(|e| e.to_string())?;

  tx.commit().map_err(|e| e.to_string())?;

  Ok(())
}

#[tauri::command]
pub fn task_restore(state: State<'_, AppState>, id: i64) -> Result<(), String> {
  let mut db = state.db().lock().map_err(|e| e.to_string())?;

  let deleted_at: Option<String> = db
    .query_row(
      "SELECT deleted_at FROM tasks WHERE id = ?1",
      rusqlite::params![id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Task not found or undo window expired".to_string())?;

  let deleted_at = deleted_at.ok_or_else(|| "Task is not deleted".to_string())?;
  let deleted_time = DateTime::parse_from_rfc3339(&deleted_at)
    .map_err(|_| "Task is no longer restorable".to_string())?
    .with_timezone(&Utc);

  if Utc::now().signed_duration_since(deleted_time) > Duration::seconds(10) {
    return Err("Undo window expired".to_string());
  }

  let now = Utc::now().to_rfc3339();
  let tx = db.transaction().map_err(|e| e.to_string())?;

  tx.execute(
    "WITH RECURSIVE subtree(id) AS (
       SELECT id FROM tasks WHERE id = ?1
       UNION ALL
       SELECT t.id
       FROM tasks t
       JOIN subtree s ON t.parent_id = s.id
     )
     UPDATE tasks
     SET deleted_at = NULL, updated_at = ?2
     WHERE id IN (SELECT id FROM subtree)",
    rusqlite::params![id, now],
  )
  .map_err(|e| e.to_string())?;

  tx.commit().map_err(|e| e.to_string())?;

  Ok(())
}
