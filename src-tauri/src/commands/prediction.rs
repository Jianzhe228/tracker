use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::AppState;
use crate::services::prediction_engine::{
    derive_time_fields, refresh_predictions as refresh_predictions_internal,
};

// ── Types ─────────────────────────────────────────────────────────────

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
    pub project_id: Option<i64>,
    pub title_key: Option<String>,
    pub score: Option<f64>,
    pub score_breakdown: Option<String>,
    pub algorithm_version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordTaskCreationPayload {
    pub task_title: String,
    pub project_id: Option<i64>,
    pub created_at: String,
    pub is_recurring_instance: Option<bool>,
}

// ── Helper functions ──────────────────────────────────────────────────

fn get_dow(created_at: &str) -> Option<String> {
    derive_time_fields(created_at).0
}

fn get_hour(created_at: &str) -> Option<i32> {
    derive_time_fields(created_at).1
}

fn get_day_of_month(created_at: &str) -> Option<i32> {
    derive_time_fields(created_at).2
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

// ── Commands: Pending Predictions ───────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PredictionRefreshResult {
    pub created_count: i64,
    pub skipped: bool,
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
            "SELECT id, title, reason, predicted_for_date, created_at, notified_at, status,
                    project_id, title_key, score, score_breakdown, algorithm_version
             FROM pending_predictions
             WHERE status IN ('pending', 'notified')
             ORDER BY score DESC, created_at DESC
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
                project_id: row.get(7)?,
                title_key: row.get(8)?,
                score: row.get(9)?,
                score_breakdown: row.get(10)?,
                algorithm_version: row.get(11)?,
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
pub fn refresh_predictions(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> Result<PredictionRefreshResult, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    let created = refresh_predictions_internal(&db, chrono::Local::now(), force.unwrap_or(false))?;

    Ok(PredictionRefreshResult {
        created_count: created.len() as i64,
        skipped: created.is_empty(),
    })
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
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    db.execute(&sql, param_refs.as_slice())
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_prediction_stats(state: State<'_, AppState>) -> Result<PredictionStats, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;

    let total: i64 = db
        .query_row("SELECT COUNT(*) FROM pending_predictions", [], |row| {
            row.get(0)
        })
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
pub fn get_recent_notification_keys(
    state: State<'_, AppState>,
    hours: Option<i64>,
) -> Result<Vec<String>, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    let hours_val = hours.unwrap_or(24);
    let cutoff = chrono::Local::now()
        .checked_sub_signed(chrono::Duration::hours(hours_val))
        .ok_or("invalid date calculation")?
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();

    let mut stmt = db
        .prepare(
            "SELECT DISTINCT title_key
             FROM pending_predictions
             WHERE notified_at IS NOT NULL
               AND notified_at >= ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![cutoff], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    let mut keys = Vec::new();
    for row in rows {
        keys.push(row.map_err(|e| e.to_string())?);
    }
    Ok(keys)
}

#[cfg(test)]
mod tests {
    use super::{get_day_of_month, get_dow, get_hour};

    #[test]
    fn derives_time_parts_from_iso_timestamp() {
        let created_at = "2026-03-29T10:24:52.954Z";

        assert!(get_dow(created_at).is_some());
        assert!(get_hour(created_at).is_some());
        assert!(get_day_of_month(created_at).is_some());
    }

    #[test]
    fn derives_time_parts_from_sqlite_timestamp() {
        let created_at = "2026-03-29 10:24:52";

        assert_eq!(get_dow(created_at).as_deref(), Some("周日"));
        assert_eq!(get_hour(created_at), Some(10));
        assert_eq!(get_day_of_month(created_at), Some(29));
    }
}
