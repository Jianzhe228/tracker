use std::collections::HashMap;

use chrono::{Duration, NaiveDateTime, Timelike};
use serde::Serialize;
use tauri::State;

use crate::db::AppState;

// ── Return types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodStats {
    pub focus_seconds: i64,
    pub pomodoros: f64,
    pub tasks_completed: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsOverview {
    pub today: PeriodStats,
    pub week: PeriodStats,
    pub total: PeriodStats,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapEntry {
    pub date: String,
    pub focus_seconds: i64,
    pub task_count: i64,
    pub pomodoro_count: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayHourDistributionEntry {
    pub date: String,
    pub hour: i64,
    pub total_seconds: i64,
    pub session_count: i64,
    pub pomodoro_count: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCompletionStats {
    pub total: i64,
    pub done: i64,
    pub todo: i64,
    pub cancelled: i64,
    pub overdue: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EstimationComparison {
    pub task_id: i64,
    pub task_title: String,
    pub estimated_seconds: i64,
    pub actual_seconds: i64,
    pub deviation_percentage: f64,
    pub completed_at: String,
}

// ── Helpers ─────────────────────────────────────────────────────────────────

fn query_focus_stats(db: &rusqlite::Connection, date_filter: &str) -> Result<(i64, f64), String> {
    let sql = format!(
        "SELECT COALESCE(SUM(duration_seconds), 0), COALESCE(SUM(pomodoro_count), 0.0)
     FROM focus_sessions
     WHERE type = 'focus' AND status IN ('completed', 'stopped')
     {}",
        date_filter
    );
    db.query_row(&sql, [], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())
}

fn query_task_completed_count(db: &rusqlite::Connection, date_filter: &str) -> Result<i64, String> {
    let sql = format!(
        "SELECT COUNT(*) FROM tasks WHERE status = 'done' AND deleted_at IS NULL {}",
        date_filter
    );
    db.query_row(&sql, [], |row| row.get(0))
        .map_err(|e| e.to_string())
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn stats_overview(state: State<'_, AppState>) -> Result<StatsOverview, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;

    let (today_focus, today_pom) = query_focus_stats(
        &db,
        "AND date(start_time, 'localtime') = date('now', 'localtime')",
    )?;
    let today_tasks = query_task_completed_count(
        &db,
        "AND date(completed_at, 'localtime') = date('now', 'localtime')",
    )?;

    let (week_focus, week_pom) = query_focus_stats(
        &db,
        "AND date(start_time, 'localtime') >= date('now', 'localtime', '-6 days')",
    )?;
    let week_tasks = query_task_completed_count(
        &db,
        "AND date(completed_at, 'localtime') >= date('now', 'localtime', '-6 days')",
    )?;

    let (total_focus, total_pom) = query_focus_stats(&db, "")?;
    let total_tasks = query_task_completed_count(&db, "")?;

    Ok(StatsOverview {
        today: PeriodStats {
            focus_seconds: today_focus,
            pomodoros: today_pom,
            tasks_completed: today_tasks,
        },
        week: PeriodStats {
            focus_seconds: week_focus,
            pomodoros: week_pom,
            tasks_completed: week_tasks,
        },
        total: PeriodStats {
            focus_seconds: total_focus,
            pomodoros: total_pom,
            tasks_completed: total_tasks,
        },
    })
}

#[tauri::command]
pub fn stats_heatmap(state: State<'_, AppState>, year: i64) -> Result<Vec<HeatmapEntry>, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;

    let year_start = format!("{}-01-01", year);
    let year_end = format!("{}-12-31", year);

    let mut stmt = db
        .prepare(
            "SELECT date(start_time, 'localtime') as d,
              COALESCE(SUM(duration_seconds), 0),
              COALESCE(SUM(pomodoro_count), 0.0)
       FROM focus_sessions
       WHERE type = 'focus'
         AND status IN ('completed', 'stopped')
         AND date(start_time, 'localtime') BETWEEN ?1 AND ?2
       GROUP BY d",
        )
        .map_err(|e| e.to_string())?;

    let mut map = std::collections::HashMap::<String, (i64, i64, f64)>::new();

    let rows = stmt
        .query_map(rusqlite::params![year_start, year_end], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, f64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (date, focus_secs, pom_count) = row.map_err(|e| e.to_string())?;
        let entry = map.entry(date).or_insert((0, 0, 0.0));
        entry.0 += focus_secs;
        entry.2 += pom_count;
    }

    let mut stmt2 = db
        .prepare(
            "SELECT date(completed_at, 'localtime') as d, COUNT(*)
       FROM tasks
       WHERE status = 'done'
         AND deleted_at IS NULL
         AND date(completed_at, 'localtime') BETWEEN ?1 AND ?2
       GROUP BY d",
        )
        .map_err(|e| e.to_string())?;

    let rows2 = stmt2
        .query_map(rusqlite::params![year_start, year_end], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?;

    for row in rows2 {
        let (date, task_count) = row.map_err(|e| e.to_string())?;
        let entry = map.entry(date).or_insert((0, 0, 0.0));
        entry.1 += task_count;
    }

    let mut result: Vec<HeatmapEntry> = map
        .into_iter()
        .map(
            |(date, (focus_seconds, task_count, pomodoro_count))| HeatmapEntry {
                date,
                focus_seconds,
                task_count,
                pomodoro_count,
            },
        )
        .collect();

    result.sort_by(|a, b| a.date.cmp(&b.date));
    Ok(result)
}

#[tauri::command]
pub fn stats_day_hour_distribution(
    state: State<'_, AppState>,
    days: Option<i64>,
) -> Result<Vec<DayHourDistributionEntry>, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;

    let day_count = days.unwrap_or(14).clamp(7, 31);
    let start_modifier = format!("-{} days", day_count - 1);

    // Fetch raw session rows (local start time, duration, pomodoro). Splitting
    // across hour boundaries is done in Rust so a session like 15:30 + 2h
    // correctly contributes 30min to 15:00, 60min to 16:00, 30min to 17:00.
    let mut stmt = db
        .prepare(
            "SELECT datetime(start_time, 'localtime') AS start_local,
                    COALESCE(duration_seconds, 0) AS duration,
                    COALESCE(pomodoro_count, 0.0) AS pomodoro
             FROM focus_sessions
             WHERE type = 'focus'
               AND status IN ('completed', 'stopped')
               AND date(start_time, 'localtime') >= date('now', 'localtime', ?1)
               AND date(start_time, 'localtime') <= date('now', 'localtime')",
        )
        .map_err(|e| e.to_string())?;

    struct Raw {
        start_local: String,
        duration: i64,
        pomodoro: f64,
    }

    let raw_rows = stmt
        .query_map(rusqlite::params![start_modifier], |row| {
            Ok(Raw {
                start_local: row.get(0)?,
                duration: row.get(1)?,
                pomodoro: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Accumulator: (date_key, hour) -> (total_seconds, session_count, pomodoro_count)
    let mut buckets: HashMap<(String, i64), (i64, i64, f64)> = HashMap::new();

    for row in raw_rows {
        if row.duration <= 0 {
            continue;
        }
        // SQLite's datetime(..., 'localtime') returns 'YYYY-MM-DD HH:MM:SS'
        let Ok(start) = NaiveDateTime::parse_from_str(&row.start_local, "%Y-%m-%d %H:%M:%S")
        else {
            continue;
        };
        let end = start + Duration::seconds(row.duration);
        let total_duration_secs = row.duration.max(1) as f64;

        let mut cursor = start;
        while cursor < end {
            let Some(hour_top) = cursor.date().and_hms_opt(cursor.hour(), 0, 0) else {
                break;
            };
            let next_hour_top = hour_top + Duration::hours(1);
            let slice_end = if next_hour_top < end {
                next_hour_top
            } else {
                end
            };
            let slice_secs = (slice_end - cursor).num_seconds().max(0);
            if slice_secs == 0 {
                break;
            }

            let key = (
                cursor.format("%Y-%m-%d").to_string(),
                cursor.hour() as i64,
            );
            let entry = buckets.entry(key).or_insert((0, 0, 0.0));
            entry.0 += slice_secs;
            // Count this session once per hour cell it touches, so "活跃次数"
            // reflects actual activity in that hour rather than only the
            // starting hour.
            entry.1 += 1;
            // Split pomodoro credit proportionally to duration share.
            entry.2 += row.pomodoro * (slice_secs as f64 / total_duration_secs);

            cursor = slice_end;
        }
    }

    let mut results: Vec<DayHourDistributionEntry> = buckets
        .into_iter()
        .map(
            |((date, hour), (total_seconds, session_count, pomodoro_count))| {
                DayHourDistributionEntry {
                    date,
                    hour,
                    total_seconds,
                    session_count,
                    pomodoro_count,
                }
            },
        )
        .collect();

    // Match the previous ordering the frontend relied on.
    results.sort_by(|a, b| b.date.cmp(&a.date).then_with(|| a.hour.cmp(&b.hour)));
    Ok(results)
}

#[tauri::command]
pub fn task_completion_stats(state: State<'_, AppState>) -> Result<TaskCompletionStats, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;

    let total: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let done: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND status = 'done'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let todo: i64 = db
    .query_row(
      "SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND status IN ('todo', 'in_progress')",
      [],
      |row| row.get(0),
    )
    .map_err(|e| e.to_string())?;

    let cancelled: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND status = 'cancelled'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let overdue: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM tasks
       WHERE deleted_at IS NULL
         AND status IN ('todo', 'in_progress')
         AND due_at IS NOT NULL
         AND due_at < date('now', 'localtime')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(TaskCompletionStats {
        total,
        done,
        todo,
        cancelled,
        overdue,
    })
}

#[tauri::command]
pub fn task_estimation_comparison(
    state: State<'_, AppState>,
    from_date: Option<String>,
    to_date: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<EstimationComparison>, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;
    let limit_val = limit.unwrap_or(50);

    let mut sql = String::from(
    "SELECT task_id, task_title, estimated_seconds, actual_seconds, deviation_percentage, completed_at
     FROM task_completion_logs WHERE 1=1"
  );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref from) = from_date {
        sql.push_str(" AND completed_at >= ?");
        param_values.push(Box::new(from.clone()));
    }
    if let Some(ref to) = to_date {
        sql.push_str(" AND completed_at <= ?");
        param_values.push(Box::new(to.clone()));
    }

    sql.push_str(" ORDER BY completed_at DESC LIMIT ?");
    param_values.push(Box::new(limit_val));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();

    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(EstimationComparison {
                task_id: row.get(0)?,
                task_title: row.get(1)?,
                estimated_seconds: row.get(2)?,
                actual_seconds: row.get(3)?,
                deviation_percentage: row.get(4)?,
                completed_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

// ── Weekly statistics ───────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyFocusStat {
    pub week_start: String,
    pub total_seconds: i64,
    pub session_count: i64,
    pub pomodoro_count: f64,
}

#[tauri::command]
pub fn stats_weekly_focus(state: State<'_, AppState>) -> Result<Vec<WeeklyFocusStat>, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;

    let mut stmt = db
    .prepare(
      "SELECT strftime('%Y-%m-%d', date(start_time, 'localtime', 'weekday 0', '-6 days')) as week_start,
              SUM(duration_seconds) as total_seconds,
              COUNT(*) as session_count,
              COALESCE(SUM(pomodoro_count), 0.0) as pomodoro_count
       FROM focus_sessions
       WHERE type = 'focus' AND status IN ('completed', 'stopped')
         AND date(start_time, 'localtime') >= date('now', 'localtime', '-83 days')
       GROUP BY week_start
       ORDER BY week_start",
    )
    .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(WeeklyFocusStat {
                week_start: row.get(0)?,
                total_seconds: row.get(1)?,
                session_count: row.get(2)?,
                pomodoro_count: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyTaskVelocity {
    pub week_start: String,
    pub completed_count: i64,
}

#[tauri::command]
pub fn stats_weekly_task_velocity(
    state: State<'_, AppState>,
) -> Result<Vec<WeeklyTaskVelocity>, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;

    let mut stmt = db
    .prepare(
      "SELECT strftime('%Y-%m-%d', date(completed_at, 'localtime', 'weekday 0', '-6 days')) as week_start,
              COUNT(*) as completed_count
       FROM tasks
       WHERE status = 'done' AND completed_at IS NOT NULL AND deleted_at IS NULL
         AND parent_id IS NULL
         AND date(completed_at, 'localtime') >= date('now', 'localtime', '-83 days')
       GROUP BY week_start
       ORDER BY week_start",
    )
    .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(WeeklyTaskVelocity {
                week_start: row.get(0)?,
                completed_count: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

/// Returns the distinct years present in tasks.created_at and tasks.updated_at,
/// sorted descending. Used by DashboardView's year selector to avoid scanning
/// all tasks in memory after the lazy-load refactor.
#[tauri::command]
pub fn task_year_range(state: State<'_, AppState>) -> Result<Vec<i64>, String> {
    let db = state.db().lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare(
            "SELECT DISTINCT CAST(strftime('%Y', dt) AS INTEGER) AS y
             FROM (
               SELECT created_at AS dt FROM tasks WHERE deleted_at IS NULL
               UNION
               SELECT updated_at AS dt FROM tasks WHERE deleted_at IS NULL
             )
             WHERE y IS NOT NULL
             ORDER BY y DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(|e| e.to_string())?;

    let mut years = Vec::new();
    for row in rows {
        years.push(row.map_err(|e| e.to_string())?);
    }
    Ok(years)
}

