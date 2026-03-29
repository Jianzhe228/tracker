use std::collections::{HashMap, HashSet};

use chrono::{
    DateTime, Datelike, Duration, Local, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Timelike,
};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::json;

pub const ALGORITHM_VERSION: &str = "local-v1";
pub const MIN_HISTORY_FOR_PREDICTION: usize = 7;

const LOOKBACK_DAYS: i64 = 90;
const SUPPRESS_RECENT_DAYS: i64 = 2;
const MAX_PREDICTIONS: usize = 3;

#[derive(Debug, Clone, Serialize)]
pub struct GeneratedPrediction {
    pub title: String,
    pub title_key: String,
    pub project_id: Option<i64>,
    pub score: f64,
    pub score_breakdown: String,
    pub reason: String,
}

#[derive(Debug, Clone)]
struct HistoryEntry {
    title: String,
    title_key: String,
    project_id: Option<i64>,
    created_at: DateTime<Local>,
    weekday_name: String,
    time_bucket: &'static str,
}

#[derive(Debug, Default)]
struct FeedbackStats {
    accepted: usize,
    rejected: usize,
    notified: usize,
    expired: usize,
}

#[derive(Debug)]
struct CandidateStats {
    title: String,
    title_key: String,
    project_id: Option<i64>,
    frequency: usize,
    recency_score: f64,
    weekday_matches: usize,
    time_bucket_matches: usize,
    project_matches: usize,
    transition_matches: usize,
    feedback_score: f64,
    last_occurrence: DateTime<Local>,
    days_since_last: i64,
}

pub fn parse_timestamp(value: &str) -> Option<DateTime<Local>> {
    if let Ok(parsed) = DateTime::parse_from_rfc3339(value) {
        return Some(parsed.with_timezone(&Local));
    }

    for pattern in ["%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%d %H:%M:%S"] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(value, pattern) {
            return localize_naive_datetime(naive);
        }
    }

    if let Ok(date) = NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        return localize_naive_datetime(date.and_hms_opt(0, 0, 0)?);
    }

    None
}

pub fn derive_time_fields(created_at: &str) -> (Option<String>, Option<i32>, Option<i32>) {
    parse_timestamp(created_at)
        .map(|parsed| {
            (
                Some(weekday_name(parsed.weekday()).to_string()),
                Some(parsed.hour() as i32),
                Some(parsed.day() as i32),
            )
        })
        .unwrap_or((None, None, None))
}

pub fn normalize_title_key(title: &str) -> String {
    let mut normalized = title.trim().to_lowercase();
    for prefix in [
        "创建任务",
        "创建",
        "添加任务",
        "添加",
        "新增任务",
        "新增",
        "安排",
    ] {
        if let Some(rest) = normalized.strip_prefix(prefix) {
            normalized = rest.trim_start().to_string();
            break;
        }
    }

    let cleaned = normalized
        .chars()
        .map(|ch| if is_title_char(ch) { ch } else { ' ' })
        .collect::<String>();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        title.trim().to_string()
    } else {
        collapsed
    }
}

pub fn should_refresh_predictions(conn: &Connection, now: DateTime<Local>) -> Result<bool, String> {
    let last_run: Option<String> = conn
        .query_row(
            "SELECT MAX(created_at) FROM pending_predictions WHERE algorithm_version = ?1",
            params![ALGORITHM_VERSION],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let Some(last_run) = last_run else {
        return Ok(true);
    };

    let Some(last_run_at) = parse_timestamp(&last_run) else {
        return Ok(true);
    };

    Ok(now.signed_duration_since(last_run_at).num_hours() >= 1)
}

pub fn refresh_predictions(
    conn: &Connection,
    now: DateTime<Local>,
    force: bool,
) -> Result<Vec<GeneratedPrediction>, String> {
    if !force && !should_refresh_predictions(conn, now)? {
        return Ok(Vec::new());
    }

    let history = load_history(conn, now, LOOKBACK_DAYS)?;
    if history.len() < MIN_HISTORY_FOR_PREDICTION {
        return Ok(Vec::new());
    }

    let active_keys = load_active_task_keys(conn)?;
    let feedback = load_feedback(conn)?;
    let predictions = score_candidates(&history, &active_keys, &feedback, now);
    if predictions.is_empty() {
        return Ok(Vec::new());
    }

    conn.execute(
        "UPDATE pending_predictions
         SET status = 'expired'
         WHERE status IN ('pending', 'notified')
           AND algorithm_version = ?1",
        params![ALGORITHM_VERSION],
    )
    .map_err(|e| e.to_string())?;

    let predicted_for_date = now.format("%Y-%m-%d").to_string();
    for prediction in &predictions {
        conn.execute(
            "INSERT INTO pending_predictions (
                title, reason, predicted_for_date, created_at, notified_at, status, ai_context, source_job_id,
                project_id, title_key, score, score_breakdown, algorithm_version
             ) VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP, NULL, 'pending', NULL, NULL, ?4, ?5, ?6, ?7, ?8)",
            params![
                prediction.title,
                prediction.reason,
                predicted_for_date,
                prediction.project_id,
                prediction.title_key,
                prediction.score,
                prediction.score_breakdown,
                ALGORITHM_VERSION,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(predictions)
}

fn localize_naive_datetime(naive: NaiveDateTime) -> Option<DateTime<Local>> {
    match Local.from_local_datetime(&naive) {
        LocalResult::Single(dt) => Some(dt),
        LocalResult::Ambiguous(early, _) => Some(early),
        LocalResult::None => None,
    }
}

fn weekday_name(weekday: chrono::Weekday) -> &'static str {
    match weekday.num_days_from_monday() {
        0 => "周一",
        1 => "周二",
        2 => "周三",
        3 => "周四",
        4 => "周五",
        5 => "周六",
        6 => "周日",
        _ => "未知",
    }
}

fn time_bucket_for_hour(hour: u32) -> &'static str {
    match hour {
        0..=5 => "深夜",
        6..=8 => "清晨",
        9..=11 => "上午",
        12..=13 => "中午",
        14..=17 => "下午",
        _ => "晚上",
    }
}

fn is_title_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ('\u{4e00}'..='\u{9fff}').contains(&ch)
}

fn load_history(
    conn: &Connection,
    now: DateTime<Local>,
    lookback_days: i64,
) -> Result<Vec<HistoryEntry>, String> {
    let cutoff = now - Duration::days(lookback_days);
    let mut stmt = conn
        .prepare(
            "SELECT task_title, project_id, created_at
             FROM task_creation_history
             WHERE is_recurring_instance = 0
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut history = Vec::new();
    for row in rows {
        let (title, project_id, created_at) = row.map_err(|e| e.to_string())?;
        let Some(parsed) = parse_timestamp(&created_at) else {
            continue;
        };
        if parsed < cutoff {
            continue;
        }

        history.push(HistoryEntry {
            title_key: normalize_title_key(&title),
            title,
            project_id,
            weekday_name: weekday_name(parsed.weekday()).to_string(),
            time_bucket: time_bucket_for_hour(parsed.hour()),
            created_at: parsed,
        });
    }

    Ok(history)
}

fn load_active_task_keys(conn: &Connection) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT title
             FROM tasks
             WHERE deleted_at IS NULL
               AND status IN ('todo', 'in_progress')",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    let mut active_keys = HashSet::new();
    for row in rows {
        active_keys.insert(normalize_title_key(&row.map_err(|e| e.to_string())?));
    }
    Ok(active_keys)
}

fn load_feedback(
    conn: &Connection,
) -> Result<HashMap<(String, Option<i64>), FeedbackStats>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT COALESCE(title_key, ''), project_id, status
             FROM pending_predictions
             WHERE status IN ('accepted', 'rejected', 'notified', 'expired')",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut feedback: HashMap<(String, Option<i64>), FeedbackStats> = HashMap::new();
    for row in rows {
        let (title_key, project_id, status) = row.map_err(|e| e.to_string())?;
        if title_key.is_empty() {
            continue;
        }
        let entry = feedback.entry((title_key, project_id)).or_default();
        match status.as_str() {
            "accepted" => entry.accepted += 1,
            "rejected" => entry.rejected += 1,
            "notified" => entry.notified += 1,
            "expired" => entry.expired += 1,
            _ => {}
        }
    }

    Ok(feedback)
}

fn score_candidates(
    history: &[HistoryEntry],
    active_keys: &HashSet<String>,
    feedback: &HashMap<(String, Option<i64>), FeedbackStats>,
    now: DateTime<Local>,
) -> Vec<GeneratedPrediction> {
    let Some(last_entry) = history.last() else {
        return Vec::new();
    };

    let current_weekday = weekday_name(now.weekday()).to_string();
    let current_bucket = time_bucket_for_hour(now.hour());
    let current_project = last_entry.project_id;
    let mut groups: HashMap<(String, Option<i64>), CandidateStats> = HashMap::new();

    for entry in history {
        let days_ago = now
            .signed_duration_since(entry.created_at)
            .num_days()
            .max(0) as f64;
        let recency_weight = 1.0 / (1.0 + days_ago / 7.0);
        let key = (entry.title_key.clone(), entry.project_id);

        let candidate = groups.entry(key.clone()).or_insert_with(|| CandidateStats {
            title: entry.title.clone(),
            title_key: entry.title_key.clone(),
            project_id: entry.project_id,
            frequency: 0,
            recency_score: 0.0,
            weekday_matches: 0,
            time_bucket_matches: 0,
            project_matches: 0,
            transition_matches: 0,
            feedback_score: 0.0,
            last_occurrence: entry.created_at,
            days_since_last: i64::MAX,
        });

        candidate.frequency += 1;
        candidate.recency_score += recency_weight;
        candidate.weekday_matches += usize::from(entry.weekday_name == current_weekday);
        candidate.time_bucket_matches += usize::from(entry.time_bucket == current_bucket);
        candidate.project_matches +=
            usize::from(entry.project_id == current_project && entry.project_id.is_some());
        if entry.created_at >= candidate.last_occurrence {
            candidate.last_occurrence = entry.created_at;
            candidate.title = entry.title.clone();
        }
    }

    for window in history.windows(2) {
        let previous = &window[0];
        let next = &window[1];
        if previous.title_key == last_entry.title_key {
            if let Some(candidate) = groups.get_mut(&(next.title_key.clone(), next.project_id)) {
                candidate.transition_matches += 1;
            }
        }
    }

    let mut predictions = groups
        .into_values()
        .filter_map(|mut candidate| {
            if active_keys.contains(&candidate.title_key) {
                return None;
            }

            candidate.days_since_last = now
                .signed_duration_since(candidate.last_occurrence)
                .num_days()
                .max(0);
            if candidate.days_since_last < SUPPRESS_RECENT_DAYS {
                return None;
            }

            if let Some(stats) = feedback.get(&(candidate.title_key.clone(), candidate.project_id))
            {
                candidate.feedback_score = stats.accepted as f64 * 1.5
                    - stats.rejected as f64 * 2.5
                    - stats.notified as f64 * 0.35
                    - stats.expired as f64 * 0.75;
            }

            let score = candidate.frequency as f64 * 1.3
                + candidate.recency_score * 2.2
                + candidate.weekday_matches as f64 * 1.5
                + candidate.time_bucket_matches as f64 * 1.1
                + candidate.project_matches as f64 * 0.8
                + candidate.transition_matches as f64 * 1.8
                + candidate.feedback_score;

            if score < 4.5 {
                return None;
            }

            let score_breakdown = json!({
                "frequency": candidate.frequency,
                "recencyScore": candidate.recency_score,
                "weekdayMatches": candidate.weekday_matches,
                "timeBucketMatches": candidate.time_bucket_matches,
                "projectMatches": candidate.project_matches,
                "transitionMatches": candidate.transition_matches,
                "feedbackScore": candidate.feedback_score,
                "daysSinceLast": candidate.days_since_last,
                "lastHour": candidate.last_occurrence.hour(),
                "lastDayOfMonth": candidate.last_occurrence.day(),
            })
            .to_string();

            let reason = build_reason(&candidate, current_weekday.as_str(), current_bucket);

            Some(GeneratedPrediction {
                title: candidate.title,
                title_key: candidate.title_key,
                project_id: candidate.project_id,
                score,
                score_breakdown,
                reason,
            })
        })
        .collect::<Vec<_>>();

    predictions.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.title.cmp(&right.title))
    });
    predictions.truncate(MAX_PREDICTIONS);
    predictions
}

fn build_reason(candidate: &CandidateStats, weekday_name: &str, time_bucket: &str) -> String {
    if candidate.weekday_matches >= 2 && candidate.time_bucket_matches >= 2 {
        return format!(
            "过去几周你多次在{}{}创建过类似任务",
            weekday_name, time_bucket
        );
    }

    if candidate.transition_matches >= 2 {
        return "这类任务经常出现在你最近的创建节奏里".to_string();
    }

    if candidate.project_matches >= 2 {
        return "这是你最近活跃项目里反复出现的任务".to_string();
    }

    if candidate.frequency >= 3 {
        return "这类任务在你的历史记录里出现得很稳定".to_string();
    }

    "这是你近期重复创建过的任务".to_string()
}

#[cfg(test)]
mod tests {
    use chrono::{Local, TimeZone};
    use rusqlite::Connection;

    use super::{normalize_title_key, refresh_predictions};
    use crate::db::run_migrations;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        run_migrations(&conn).expect("run migrations");
        conn.execute(
            "INSERT OR IGNORE INTO projects (id, title, color, icon) VALUES (1, '收集箱', '#6b7280', 'inbox')",
            [],
        )
        .expect("seed inbox");
        conn
    }

    #[test]
    fn normalizes_common_creation_prefixes() {
        assert_eq!(normalize_title_key("创建 本周计划"), "本周计划");
        assert_eq!(normalize_title_key("添加 周复盘"), "周复盘");
    }

    #[test]
    fn generates_predictions_from_repeated_history() {
        let conn = setup_db();
        let now = Local
            .with_ymd_and_hms(2026, 3, 30, 9, 0, 0)
            .single()
            .expect("valid timestamp");

        for day in [2, 9, 16, 23] {
            conn.execute(
                "INSERT INTO task_creation_history (task_title, project_id, created_at, dow, hour, day_of_month, is_recurring_instance)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
                rusqlite::params![
                    "本周计划",
                    1_i64,
                    format!("2026-03-{day:02}T09:00:00Z"),
                    "周一",
                    9_i64,
                    day,
                ],
            )
            .expect("insert history");
        }

        for day in [3, 10, 17] {
            conn.execute(
                "INSERT INTO task_creation_history (task_title, project_id, created_at, dow, hour, day_of_month, is_recurring_instance)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
                rusqlite::params![
                    "整理收集箱",
                    1_i64,
                    format!("2026-03-{day:02}T18:00:00Z"),
                    "周二",
                    18_i64,
                    day,
                ],
            )
            .expect("insert history");
        }

        let predictions = refresh_predictions(&conn, now, true).expect("refresh predictions");

        assert!(!predictions.is_empty());
        assert_eq!(predictions[0].title, "本周计划");
        assert_eq!(predictions[0].project_id, Some(1));
        assert!(predictions[0].score > 0.0);
    }

    #[test]
    fn suppresses_predictions_when_same_title_is_still_active() {
        let conn = setup_db();
        let now = Local
            .with_ymd_and_hms(2026, 3, 30, 9, 0, 0)
            .single()
            .expect("valid timestamp");

        for day in [2, 9, 16, 20, 21, 22, 23] {
            conn.execute(
                "INSERT INTO task_creation_history (task_title, project_id, created_at, dow, hour, day_of_month, is_recurring_instance)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
                rusqlite::params![
                    "本周计划",
                    1_i64,
                    format!("2026-03-{day:02}T09:00:00Z"),
                    "周一",
                    9_i64,
                    day,
                ],
            )
            .expect("insert history");
        }

        conn.execute(
            "INSERT INTO tasks (title, status, project_id, created_at, updated_at)
             VALUES ('本周计划', 'todo', 1, '2026-03-30 08:00:00', '2026-03-30 08:00:00')",
            [],
        )
        .expect("insert active task");

        let predictions = refresh_predictions(&conn, now, true).expect("refresh predictions");

        assert!(predictions
            .iter()
            .all(|prediction| prediction.title != "本周计划"));
    }
}
