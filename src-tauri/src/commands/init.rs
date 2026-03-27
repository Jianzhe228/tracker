use serde::Serialize;
use tauri::State;

use crate::commands::project::ProjectRow;
use crate::commands::recurring::RecurringRuleRow;
use crate::commands::settings::SettingEntry;
use crate::commands::task::TaskRow;
use crate::db::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInitData {
    pub tasks: Vec<TaskRow>,
    pub settings: Vec<SettingEntry>,
    pub projects: Vec<ProjectRow>,
    pub recurring_rules: Vec<RecurringRuleRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInitResult {
    pub tasks: Vec<TaskRow>,
    pub total_count: i64,
}

/// Load tasks with pagination for initial app load.
/// Uses cursor-based pagination via OFFSET for simplicity.
#[tauri::command]
pub fn task_list_init(
    state: State<'_, AppState>,
    offset: Option<i64>,
    limit: Option<i64>,
) -> Result<TaskInitResult, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    let offset_val = offset.unwrap_or(0);
    let limit_val = limit.unwrap_or(500).min(1000); // Cap at 1000

    // Get total count
    let total_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let mut stmt = db
    .prepare(
      "SELECT id, title, status, priority, project_id, parent_id, due_at, start_at, reminder_time, completed_at, deleted_at, notes, pomodoro_count, pomodoro_duration, sort_order, recurring_rule_id, created_at, updated_at, rescheduled_to
       FROM tasks
       WHERE deleted_at IS NULL
       ORDER BY sort_order ASC, created_at DESC
       LIMIT ?1 OFFSET ?2",
    )
    .map_err(|e| e.to_string())?;
    let tasks: Vec<TaskRow> = stmt
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
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(TaskInitResult { tasks, total_count })
}

#[tauri::command]
pub fn app_init(state: State<'_, AppState>) -> Result<AppInitData, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    crate::commands::task::cleanup_expired_soft_deleted_tasks(&db)?;

    // Generate recurring task instances for today
    crate::services::recurring::generate_recurring_tasks(&db, &today)?;

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

    // Tasks loaded separately via task_list_init for pagination
    let tasks: Vec<TaskRow> = Vec::new();

    Ok(AppInitData {
        tasks,
        settings,
        projects,
        recurring_rules,
    })
}
