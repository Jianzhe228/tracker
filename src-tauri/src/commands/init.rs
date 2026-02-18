use serde::Serialize;
use tauri::State;

use crate::commands::habit::HabitRow;
use crate::commands::project::ProjectRow;
use crate::commands::recurring::RecurringRuleRow;
use crate::commands::settings::SettingEntry;
use crate::commands::task::TaskRow;
use crate::db::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInitData {
  pub tasks: Vec<TaskRow>,
  pub habits: Vec<HabitRow>,
  pub settings: Vec<SettingEntry>,
  pub projects: Vec<ProjectRow>,
  pub recurring_rules: Vec<RecurringRuleRow>,
}

#[tauri::command]
pub fn app_init(state: State<'_, AppState>) -> Result<AppInitData, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  let today = chrono::Local::now().format("%Y-%m-%d").to_string();

  crate::commands::task::cleanup_expired_soft_deleted_tasks(&db)?;

  // Generate recurring task instances for today
  crate::services::recurring::generate_recurring_tasks(&db, &today)?;

  // Tasks (excluding soft-deleted)
  let mut stmt = db
    .prepare(
      "SELECT id, title, status, priority, project_id, parent_id, due_at, reminder_time, completed_at, deleted_at, notes, pomodoro_count, pomodoro_duration, sort_order, recurring_rule_id, created_at, updated_at
       FROM tasks
       WHERE deleted_at IS NULL
       ORDER BY sort_order ASC, created_at DESC",
    )
    .map_err(|e| e.to_string())?;
  let tasks: Vec<TaskRow> = stmt
    .query_map([], |row| {
      Ok(TaskRow {
        id: row.get(0)?,
        title: row.get(1)?,
        status: row.get(2)?,
        priority: row.get(3)?,
        project_id: row.get(4)?,
        parent_id: row.get(5)?,
        due_at: row.get(6)?,
        reminder_time: row.get(7)?,
        completed_at: row.get(8)?,
        deleted_at: row.get(9)?,
        notes: row.get(10)?,
        pomodoro_count: row.get(11)?,
        pomodoro_duration: row.get(12)?,
        sort_order: row.get(13)?,
        recurring_rule_id: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
      })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

  // Habits
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
  let habits: Vec<HabitRow> = stmt
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
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

  // Settings
  let mut stmt = db
    .prepare("SELECT key, value FROM user_settings")
    .map_err(|e| e.to_string())?;
  let settings: Vec<SettingEntry> = stmt
    .query_map([], |row| {
      Ok(SettingEntry {
        key: row.get(0)?,
        value: row.get(1)?,
      })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

  // Projects
  let mut stmt = db
    .prepare("SELECT id, title, color, icon, parent_id, created_at, updated_at FROM projects ORDER BY id ASC")
    .map_err(|e| e.to_string())?;
  let projects: Vec<ProjectRow> = stmt
    .query_map([], |row| {
      Ok(ProjectRow {
        id: row.get(0)?,
        title: row.get(1)?,
        color: row.get(2)?,
        icon: row.get(3)?,
        parent_id: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
      })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

  // Recurring rules (active only)
  let mut stmt = db
    .prepare(
      "SELECT id, title, description, priority, project_id, repeat_type, repeat_days, anchor_date, reminder_time, notes, pomodoro_count, pomodoro_duration, active, last_generated_date, created_at, updated_at
       FROM recurring_rules
       WHERE active = 1
       ORDER BY id ASC",
    )
    .map_err(|e| e.to_string())?;
  let recurring_rules: Vec<RecurringRuleRow> = stmt
    .query_map([], |row| {
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
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

  Ok(AppInitData {
    tasks,
    habits,
    settings,
    projects,
    recurring_rules,
  })
}
