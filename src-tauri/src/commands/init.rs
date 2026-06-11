use serde::Serialize;
use tauri::State;

use crate::commands::project::ProjectRow;
use crate::commands::recurring::RecurringRuleRow;
use crate::commands::settings::SettingEntry;
use crate::db::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInitData {
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
        settings,
        projects,
        recurring_rules,
    })
}
