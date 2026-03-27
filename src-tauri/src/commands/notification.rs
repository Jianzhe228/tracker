use serde::Serialize;
use tauri::State;

use crate::db::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationLogRow {
    pub id: i64,
    pub r#type: String,
    pub title: String,
    pub body: String,
    pub payload: Option<String>,
    pub is_read: bool,
    pub read_at: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub fn notification_create(
    state: State<'_, AppState>,
    r#type: String,
    title: String,
    body: String,
    payload: Option<String>,
) -> Result<i64, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO notification_logs (type, title, body, payload) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![r#type, title, body, payload],
    )
    .map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn notification_list(
    state: State<'_, AppState>,
    limit: Option<i64>,
    offset: Option<i64>,
    unread_only: Option<bool>,
) -> Result<Vec<NotificationLogRow>, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    let limit_val = limit.unwrap_or(50);
    let offset_val = offset.unwrap_or(0);
    let unread = unread_only.unwrap_or(false);

    let sql = if unread {
        "SELECT id, type, title, body, payload, is_read, read_at, created_at
     FROM notification_logs
     WHERE is_read = 0
     ORDER BY created_at DESC
     LIMIT ?1 OFFSET ?2"
    } else {
        "SELECT id, type, title, body, payload, is_read, read_at, created_at
     FROM notification_logs
     ORDER BY created_at DESC
     LIMIT ?1 OFFSET ?2"
    };

    let mut stmt = db.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![limit_val, offset_val], |row| {
            Ok(NotificationLogRow {
                id: row.get(0)?,
                r#type: row.get(1)?,
                title: row.get(2)?,
                body: row.get(3)?,
                payload: row.get(4)?,
                is_read: row.get(5)?,
                read_at: row.get(6)?,
                created_at: row.get(7)?,
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
pub fn notification_mark_read(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE notification_logs SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn notification_mark_all_read(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE notification_logs SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE is_read = 0",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn notification_unread_count(state: State<'_, AppState>) -> Result<i64, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    let count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM notification_logs WHERE is_read = 0",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count)
}
