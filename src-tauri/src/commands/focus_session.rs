use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentPayload {
  pub task_id: Option<i64>,
  pub start_time: String,
  pub duration_seconds: i64,
  pub sort_order: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSessionCreatePayload {
  pub task_id: Option<i64>,
  pub start_time: String,
  pub end_time: String,
  pub duration_seconds: i64,
  #[serde(rename = "type")]
  pub session_type: String,
  pub status: String,
  pub interruption_reason: Option<String>,
  pub pomodoro_count: Option<i64>,
  pub segments: Option<Vec<SegmentPayload>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSessionRow {
  pub id: i64,
  pub task_id: Option<i64>,
  pub start_time: String,
  pub end_time: Option<String>,
  pub duration_seconds: i64,
  #[serde(rename = "type")]
  pub session_type: String,
  pub status: String,
  pub interruption_reason: Option<String>,
  pub pomodoro_count: i64,
  pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSessionStats {
  pub total_focus_seconds: i64,
  pub total_pomodoros: i64,
  pub session_count: i64,
  pub hourly_distribution: Vec<HourlyBucket>,
  pub daily_totals: Vec<DailyTotal>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HourlyBucket {
  pub hour: i64,
  pub total_seconds: i64,
  pub session_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyTotal {
  pub date: String,
  pub total_seconds: i64,
  pub pomodoro_count: i64,
  pub session_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTimeStat {
  pub project_id: Option<i64>,
  pub project_title: String,
  pub total_seconds: i64,
  pub session_count: i64,
}

#[tauri::command]
pub fn focus_session_create(
  state: State<'_, AppState>,
  payload: FocusSessionCreatePayload,
) -> Result<FocusSessionRow, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;

  db.execute(
    "INSERT INTO focus_sessions (task_id, start_time, end_time, duration_seconds, type, status, interruption_reason, pomodoro_count)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    rusqlite::params![
      payload.task_id,
      payload.start_time,
      payload.end_time,
      payload.duration_seconds,
      payload.session_type,
      payload.status,
      payload.interruption_reason,
      payload.pomodoro_count.unwrap_or(1),
    ],
  )
  .map_err(|e| e.to_string())?;

  let id = db.last_insert_rowid();

  // Insert segments if provided
  if let Some(ref segments) = payload.segments {
    for seg in segments {
      db.execute(
        "INSERT INTO focus_session_segments (session_id, task_id, start_time, duration_seconds, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, seg.task_id, seg.start_time, seg.duration_seconds, seg.sort_order],
      )
      .map_err(|e| e.to_string())?;
    }
  }

  let created_at: String = db
    .query_row(
      "SELECT created_at FROM focus_sessions WHERE id = ?1",
      rusqlite::params![id],
      |row| row.get(0),
    )
    .map_err(|e| e.to_string())?;

  Ok(FocusSessionRow {
    id,
    task_id: payload.task_id,
    start_time: payload.start_time,
    end_time: Some(payload.end_time),
    duration_seconds: payload.duration_seconds,
    session_type: payload.session_type,
    status: payload.status,
    interruption_reason: payload.interruption_reason,
    pomodoro_count: payload.pomodoro_count.unwrap_or(1),
    created_at,
  })
}

#[tauri::command]
pub fn focus_session_list(
  state: State<'_, AppState>,
  from_date: Option<String>,
  to_date: Option<String>,
  limit: Option<i64>,
) -> Result<Vec<FocusSessionRow>, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;
  let limit_val = limit.unwrap_or(500);

  let mut sql = String::from(
    "SELECT id, task_id, start_time, end_time, duration_seconds, type, status, interruption_reason, pomodoro_count, created_at
     FROM focus_sessions WHERE 1=1"
  );
  let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

  if let Some(ref from) = from_date {
    sql.push_str(" AND start_time >= ?");
    param_values.push(Box::new(from.clone()));
  }
  if let Some(ref to) = to_date {
    sql.push_str(" AND start_time <= ?");
    param_values.push(Box::new(to.clone()));
  }

  sql.push_str(" ORDER BY start_time DESC LIMIT ?");
  param_values.push(Box::new(limit_val));

  let param_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

  let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map(param_refs.as_slice(), |row| {
      Ok(FocusSessionRow {
        id: row.get(0)?,
        task_id: row.get(1)?,
        start_time: row.get(2)?,
        end_time: row.get(3)?,
        duration_seconds: row.get(4)?,
        session_type: row.get(5)?,
        status: row.get(6)?,
        interruption_reason: row.get(7)?,
        pomodoro_count: row.get(8)?,
        created_at: row.get(9)?,
      })
    })
    .map_err(|e| e.to_string())?;

  let mut results = Vec::new();
  for row in rows {
    results.push(row.map_err(|e| e.to_string())?);
  }
  Ok(results)
}

#[tauri::command]
pub fn focus_session_stats(
  state: State<'_, AppState>,
  from_date: String,
  to_date: String,
) -> Result<FocusSessionStats, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;

  let (total_focus_seconds, total_pomodoros, session_count): (i64, i64, i64) = db
    .query_row(
      "SELECT COALESCE(SUM(duration_seconds), 0),
              COALESCE(SUM(pomodoro_count), 0),
              COUNT(*)
       FROM focus_sessions
       WHERE type = 'focus'
         AND status IN ('completed', 'stopped')
         AND date(start_time, 'localtime') >= date(?1)
         AND date(start_time, 'localtime') <= date(?2)",
      rusqlite::params![from_date, to_date],
      |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .map_err(|e| e.to_string())?;

  // Hourly distribution (24 buckets)
  let mut hourly_stmt = db
    .prepare(
      "SELECT CAST(strftime('%H', start_time, 'localtime') AS INTEGER) AS hour,
              COALESCE(SUM(duration_seconds), 0),
              COUNT(*)
       FROM focus_sessions
       WHERE type = 'focus'
         AND status IN ('completed', 'stopped')
         AND date(start_time, 'localtime') >= date(?1)
         AND date(start_time, 'localtime') <= date(?2)
       GROUP BY hour
       ORDER BY hour",
    )
    .map_err(|e| e.to_string())?;

  let hourly_rows = hourly_stmt
    .query_map(rusqlite::params![from_date, to_date], |row| {
      Ok(HourlyBucket {
        hour: row.get(0)?,
        total_seconds: row.get(1)?,
        session_count: row.get(2)?,
      })
    })
    .map_err(|e| e.to_string())?;

  let mut hourly_map = std::collections::HashMap::new();
  for row in hourly_rows {
    let bucket = row.map_err(|e| e.to_string())?;
    hourly_map.insert(bucket.hour, bucket);
  }

  let hourly_distribution: Vec<HourlyBucket> = (0..24)
    .map(|h| {
      hourly_map.remove(&h).unwrap_or(HourlyBucket {
        hour: h,
        total_seconds: 0,
        session_count: 0,
      })
    })
    .collect();

  // Daily totals
  let mut daily_stmt = db
    .prepare(
      "SELECT date(start_time, 'localtime') AS day,
              COALESCE(SUM(duration_seconds), 0),
              COALESCE(SUM(pomodoro_count), 0),
              COUNT(*)
       FROM focus_sessions
       WHERE type = 'focus'
         AND status IN ('completed', 'stopped')
         AND date(start_time, 'localtime') >= date(?1)
         AND date(start_time, 'localtime') <= date(?2)
       GROUP BY day
       ORDER BY day",
    )
    .map_err(|e| e.to_string())?;

  let daily_rows = daily_stmt
    .query_map(rusqlite::params![from_date, to_date], |row| {
      Ok(DailyTotal {
        date: row.get(0)?,
        total_seconds: row.get(1)?,
        pomodoro_count: row.get(2)?,
        session_count: row.get(3)?,
      })
    })
    .map_err(|e| e.to_string())?;

  let mut daily_totals = Vec::new();
  for row in daily_rows {
    daily_totals.push(row.map_err(|e| e.to_string())?);
  }

  Ok(FocusSessionStats {
    total_focus_seconds,
    total_pomodoros,
    session_count,
    hourly_distribution,
    daily_totals,
  })
}

#[tauri::command]
pub fn focus_session_project_distribution(
  state: State<'_, AppState>,
  from_date: String,
  to_date: String,
) -> Result<Vec<ProjectTimeStat>, String> {
  let db = state.db().lock().map_err(|e| e.to_string())?;

  let mut stmt = db
    .prepare(
      "SELECT t.project_id,
              COALESCE(p.title, '未分类'),
              COALESCE(SUM(fs.duration_seconds), 0),
              COUNT(*)
       FROM focus_sessions fs
       LEFT JOIN tasks t ON fs.task_id = t.id
       LEFT JOIN projects p ON t.project_id = p.id
       WHERE fs.type = 'focus'
         AND fs.status IN ('completed', 'stopped')
         AND date(fs.start_time, 'localtime') >= date(?1)
         AND date(fs.start_time, 'localtime') <= date(?2)
       GROUP BY t.project_id
       ORDER BY SUM(fs.duration_seconds) DESC",
    )
    .map_err(|e| e.to_string())?;

  let rows = stmt
    .query_map(rusqlite::params![from_date, to_date], |row| {
      Ok(ProjectTimeStat {
        project_id: row.get(0)?,
        project_title: row.get(1)?,
        total_seconds: row.get(2)?,
        session_count: row.get(3)?,
      })
    })
    .map_err(|e| e.to_string())?;

  let mut results = Vec::new();
  for row in rows {
    results.push(row.map_err(|e| e.to_string())?);
  }
  Ok(results)
}
