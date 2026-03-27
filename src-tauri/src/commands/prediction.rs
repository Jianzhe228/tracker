use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::AppState;

// ── Types ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCreationHistoryRow {
    pub id: i64,
    pub task_title: String,
    pub project_id: Option<i64>,
    pub created_at: String,
    pub dow: Option<String>,
    pub hour: Option<i32>,
    pub day_of_month: Option<i32>,
    pub is_recurring_instance: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPredictionRow {
    pub id: i64,
    pub title: String,
    pub reason: Option<String>,
    pub predicted_for_date: Option<String>,
    pub created_at: Option<String>,
    pub notified_at: Option<String>,
    pub status: String,
    pub ai_context: Option<String>,
    pub source_job_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordTaskCreationPayload {
    pub task_title: String,
    pub project_id: Option<i64>,
    pub created_at: String,
    pub is_recurring_instance: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PredictionAnalysisContext {
    pub current_time: String,
    pub day_of_week: String,
    pub days: i32,
    pub count: i32,
    pub task_list: String,
    pub recent_projects: Option<String>,
}

// ── Helper functions ──────────────────────────────────────────────────

use chrono::Datelike;

fn get_dow(created_at: &str) -> Option<String> {
    let parts: Vec<&str> = created_at.splitn(2, ' ').collect();
    let date_part = parts.get(0).or(parts.first())?;
    chrono::NaiveDate::parse_from_str(date_part, "%Y-%m-%d")
        .ok()
        .map(|d| {
            match d.weekday().num_days_from_monday() {
                0 => "周一",
                1 => "周二",
                2 => "周三",
                3 => "周四",
                4 => "周五",
                5 => "周六",
                6 => "周日",
                _ => "未知",
            }.to_string()
        })
}

fn get_hour(created_at: &str) -> Option<i32> {
    let parts: Vec<&str> = created_at.splitn(2, ' ').collect();
    if parts.len() < 2 {
        return None;
    }
    let time_part = parts.get(1)?;
    let hour_parts: Vec<&str> = time_part.split(':').collect();
    hour_parts.first()?.parse().ok()
}

fn get_day_of_month(created_at: &str) -> Option<i32> {
    let parts: Vec<&str> = created_at.splitn(2, ' ').collect();
    let date_part = parts.get(0).or(parts.first())?;
    chrono::NaiveDate::parse_from_str(date_part, "%Y-%m-%d")
        .ok()
        .map(|d| d.day() as i32)
}

// ── Commands: Task Creation History ─────────────────────────────────

#[tauri::command]
pub fn record_task_creation(
    state: State<'_, AppState>,
    payload: RecordTaskCreationPayload,
) -> Result<i64, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;

    let dow = get_dow(&payload.created_at);
    let hour = get_hour(&payload.created_at);
    let day_of_month = get_day_of_month(&payload.created_at);
    let is_recurring_instance = payload.is_recurring_instance.unwrap_or(false) as i32;

    db.execute(
        "INSERT INTO task_creation_history (task_title, project_id, created_at, dow, hour, day_of_month, is_recurring_instance)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            payload.task_title,
            payload.project_id,
            payload.created_at,
            dow,
            hour,
            day_of_month,
            is_recurring_instance,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn get_task_creation_history(
    state: State<'_, AppState>,
    days: Option<i32>,
) -> Result<Vec<TaskCreationHistoryRow>, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    let days_val = days.unwrap_or(14);

    let cutoff = chrono::Local::now()
        .checked_sub_signed(chrono::Duration::days(days_val as i64))
        .ok_or("invalid date calculation")?
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();

    let mut stmt = db
        .prepare(
            "SELECT id, task_title, project_id, created_at, dow, hour, day_of_month, is_recurring_instance
             FROM task_creation_history
             WHERE created_at >= ?1 AND is_recurring_instance = 0
             ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![cutoff], |row| {
            Ok(TaskCreationHistoryRow {
                id: row.get(0)?,
                task_title: row.get(1)?,
                project_id: row.get(2)?,
                created_at: row.get(3)?,
                dow: row.get(4)?,
                hour: row.get(5)?,
                day_of_month: row.get(6)?,
                is_recurring_instance: row.get::<_, i32>(7)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
pub fn get_prediction_analysis_context(
    state: State<'_, AppState>,
    days: Option<i32>,
) -> Result<PredictionAnalysisContext, String> {
    let history = get_task_creation_history(state, days)?;

    let now = chrono::Local::now();
    let current_time = now.format("%Y-%m-%d %H:%M").to_string();
    let day_of_week = match now.weekday().num_days_from_monday() {
        0 => "周一",
        1 => "周二",
        2 => "周三",
        3 => "周四",
        4 => "周五",
        5 => "周六",
        6 => "周日",
        _ => "未知",
    }.to_string();

    let count = history.len() as i32;
    let days_val = days.unwrap_or(14);

    // Format task list for AI
    let task_list = history
        .iter()
        .map(|h| format!("- {} ({})", h.task_title, &h.created_at[..16]))
        .collect::<Vec<_>>()
        .join("\n");

    // Get recent projects
    let recent_projects: Option<String> = {
        let projects: Vec<String> = history
            .iter()
            .filter_map(|h| h.project_id)
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .take(5)
            .map(|id| format!("项目ID:{}", id))
            .collect();
        if projects.is_empty() {
            None
        } else {
            Some(projects.join(", "))
        }
    };

    Ok(PredictionAnalysisContext {
        current_time,
        day_of_week,
        days: days_val,
        count,
        task_list,
        recent_projects,
    })
}

// ── Commands: Pending Predictions ───────────────────────────────────

#[tauri::command]
pub fn save_predictions(
    state: State<'_, AppState>,
    predictions: Vec<PredictionSavePayload>,
    ai_context: Option<String>,
    source_job_id: Option<i64>,
) -> Result<Vec<i64>, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    let mut ids = Vec::new();
    for pred in predictions {
        db.execute(
            "INSERT INTO pending_predictions (title, reason, predicted_for_date, created_at, status, ai_context, source_job_id)
             VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP, 'pending', ?4, ?5)",
            rusqlite::params![pred.title, pred.reason, today, ai_context, source_job_id],
        )
        .map_err(|e| e.to_string())?;
        ids.push(db.last_insert_rowid());
    }

    Ok(ids)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PredictionSavePayload {
    pub title: String,
    pub reason: Option<String>,
}

#[tauri::command]
pub fn get_pending_predictions(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<PendingPredictionRow>, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    let limit_val = limit.unwrap_or(10);

    let mut stmt = db
        .prepare(
            "SELECT id, title, reason, predicted_for_date, created_at, notified_at, status, ai_context, source_job_id
             FROM pending_predictions
             WHERE status IN ('pending', 'notified')
             ORDER BY created_at DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![limit_val], |row| {
            Ok(PendingPredictionRow {
                id: row.get(0)?,
                title: row.get(1)?,
                reason: row.get(2)?,
                predicted_for_date: row.get(3)?,
                created_at: row.get(4)?,
                notified_at: row.get(5)?,
                status: row.get(6)?,
                ai_context: row.get(7)?,
                source_job_id: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
pub fn update_prediction_status(
    state: State<'_, AppState>,
    id: i64,
    status: String,
) -> Result<(), String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;

    let mut sets = vec!["status = ?1".to_string()];
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(status.clone())];

    if status == "notified" {
        sets.push("notified_at = CURRENT_TIMESTAMP".to_string());
    }

    params.push(Box::new(id));
    let sql = format!(
        "UPDATE pending_predictions SET {} WHERE id = ?",
        sets.join(", ")
    );
    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        params.iter().map(|p| p.as_ref()).collect();

    db.execute(&sql, param_refs.as_slice())
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_prediction_stats(
    state: State<'_, AppState>,
) -> Result<PredictionStats, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;

    let total: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM pending_predictions",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let pending: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM pending_predictions WHERE status = 'pending'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let accepted: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM pending_predictions WHERE status = 'accepted'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let rejected: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM pending_predictions WHERE status = 'rejected'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let history_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM task_creation_history WHERE is_recurring_instance = 0",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(PredictionStats {
        total,
        pending,
        accepted,
        rejected,
        history_count,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PredictionStats {
    pub total: i64,
    pub pending: i64,
    pub accepted: i64,
    pub rejected: i64,
    pub history_count: i64,
}

#[tauri::command]
pub fn cleanup_expired_predictions(
    state: State<'_, AppState>,
    days: Option<i32>,
) -> Result<i64, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    let days_val = days.unwrap_or(7);

    let cutoff = chrono::Local::now()
        .checked_sub_signed(chrono::Duration::days(days_val as i64))
        .ok_or("invalid date calculation")?
        .format("%Y-%m-%d")
        .to_string();

    let deleted = db
        .execute(
            "UPDATE pending_predictions SET status = 'expired'
             WHERE status IN ('pending', 'notified')
               AND predicted_for_date < ?1",
            rusqlite::params![cutoff],
        )
        .map_err(|e| e.to_string())?;

    Ok(deleted as i64)
}
