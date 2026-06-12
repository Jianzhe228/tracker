//! Local prediction engine — local-v2.
//!
//! Predicts which task the user is likely to create next, from
//! `task_creation_history` alone (no LLM). v2 replaces the v1 linear
//! count-based score with a cadence model:
//!
//! - Inter-arrival gaps per candidate (distinct creation days) give a median
//!   cadence + MAD regularity; "dueness" peaks when `days_since_last` hits the
//!   median gap and decays asymmetrically when overdue.
//! - Weekday / time-bucket affinity use Laplace-smoothed lift against a
//!   uniform baseline instead of raw match counts, so frequency no longer
//!   masquerades as periodicity.
//! - Scores are calibrated to 0–100 with a fixed threshold; the breakdown is
//!   persisted per row.
//! - Refresh reconciles with the previous batch instead of force-expiring it:
//!   persisting candidates keep their row (and notified state), vanished ones
//!   expire, and only genuinely new rows are reported for notification.
//! - Title keys normalize digit runs to `#` so "3月总结" and "4月总结"
//!   aggregate into one habit.
//!
//! Timestamps written by this engine are RFC3339 with explicit local offset
//! ("%Y-%m-%dT%H:%M:%S%:z"), so reads parse unambiguously (the v1 engine wrote
//! UTC `CURRENT_TIMESTAMP` but parsed it as local time, which broke the
//! refresh throttle and feedback decay by the UTC offset).

use std::collections::{HashMap, HashSet};

use chrono::{
    DateTime, Datelike, Duration, Local, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Timelike,
};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::json;

pub const ALGORITHM_VERSION: &str = "local-v2";
pub const MIN_HISTORY_FOR_PREDICTION: usize = 7;

const LOOKBACK_DAYS: i64 = 90;
const MAX_PREDICTIONS: usize = 3;
const RECENT_FEEDBACK_DAYS: i64 = 7;
const FEEDBACK_DECAY_DAYS: f64 = 14.0;
/// Calibrated 0–100 score below which a candidate is not surfaced.
const SCORE_THRESHOLD: f64 = 38.0;
/// Predict at most this many days into the future.
const PREDICT_HORIZON_DAYS: f64 = 3.0;
/// Candidates whose cadence says "less than half a cycle elapsed" are not due.
const NOT_DUE_RATIO: f64 = 0.5;
/// Absolute floor: never re-suggest something created within the last 18h.
const MIN_DAYS_SINCE_LAST: f64 = 0.75;
/// Fallback suppression window for candidates without a usable cadence.
const IRREGULAR_SUPPRESS_DAYS: f64 = 2.0;
/// A history entry following another within this window counts as a
/// transition ("after creating X the user tends to create Y").
const TRANSITION_WINDOW_HOURS: i64 = 12;

// Feature weights — every feature is bounded to [0, 1] (feedback to [-1, 1]),
// so the maximum reachable score is roughly the sum of positive weights.
const W_DUENESS: f64 = 30.0;
const W_REGULARITY: f64 = 14.0;
const W_FREQUENCY: f64 = 16.0;
const W_DOW: f64 = 10.0;
const W_BUCKET: f64 = 6.0;
const W_TRANSITION: f64 = 9.0;
const W_RECENCY: f64 = 5.0;
const W_ACTIVE_PROJECT: f64 = 4.0;
const W_FEEDBACK: f64 = 20.0;

#[derive(Debug, Clone, Serialize)]
pub struct GeneratedPrediction {
    pub id: i64,
    pub title: String,
    pub title_key: String,
    pub project_id: Option<i64>,
    pub predicted_for_date: String,
    pub score: f64,
    pub score_breakdown: String,
    pub reason: String,
    pub is_new: bool,
}

/// Result of a reconciling refresh.
#[derive(Debug, Default)]
pub struct RefreshOutcome {
    /// Current prediction set (persisted rows, updated in place or inserted).
    pub predictions: Vec<GeneratedPrediction>,
    /// Row ids inserted this round — the only ones worth notifying about.
    pub new_ids: Vec<i64>,
    /// Whether anything changed (inserts or expiries).
    pub changed: bool,
    /// True when the 1h throttle short-circuited the refresh.
    pub throttled: bool,
}

#[derive(Debug, Clone)]
struct HistoryEntry {
    title: String,
    title_key: String,
    project_id: Option<i64>,
    created_at: DateTime<Local>,
}

#[derive(Debug, Default)]
struct FeedbackStats {
    accepted: f64,
    rejected: f64,
    expired: f64,
}

#[derive(Debug)]
struct CandidateFeatures {
    title: String,
    title_key: String,
    project_id: Option<i64>,
    distinct_days: usize,
    median_gap: Option<f64>,
    regularity: f64,
    days_since_last: f64,
    dueness: f64,
    target_date: NaiveDate,
    dow_affinity: f64,
    bucket_affinity: f64,
    transition: f64,
    recency: f64,
    active_project: f64,
    feedback: f64,
    score: f64,
}

// ── Timestamp helpers ───────────────────────────────────────────────

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

/// Canonical timestamp format for everything this engine writes.
pub fn format_timestamp(at: DateTime<Local>) -> String {
    at.format("%Y-%m-%dT%H:%M:%S%:z").to_string()
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

fn time_bucket_width_hours(bucket: &str) -> f64 {
    match bucket {
        "深夜" => 6.0,
        "清晨" => 3.0,
        "上午" => 3.0,
        "中午" => 2.0,
        "下午" => 4.0,
        _ => 6.0,
    }
}

// ── Title normalization ─────────────────────────────────────────────

/// Normalize a task title into a dedup/aggregation key:
/// lowercase, strip one leading action verb, keep CJK + ASCII alnum,
/// collapse whitespace, and replace digit runs with `#` so periodic titles
/// that only differ by a number ("3月总结" / "4月总结") share one key.
pub fn normalize_title_key(title: &str) -> String {
    let mut normalized = title.trim().to_lowercase();
    // Strip common leading verb/action prefixes. Order matters: longer first.
    for prefix in [
        "创建任务",
        "添加任务",
        "新增任务",
        "创建",
        "添加",
        "新增",
        "安排",
        "准备",
        "完成",
        "整理",
        "处理",
        "复习",
        "学习",
        "撰写",
        "编写",
        "写",
        "做",
        "搞",
        "看",
        "读",
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

    // Collapse digit runs to a placeholder so numbering doesn't split habits.
    let mut keyed = String::with_capacity(cleaned.len());
    let mut in_digits = false;
    for ch in cleaned.chars() {
        if ch.is_ascii_digit() {
            if !in_digits {
                keyed.push('#');
                in_digits = true;
            }
        } else {
            in_digits = false;
            keyed.push(ch);
        }
    }

    let collapsed = keyed.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        title.trim().to_string()
    } else {
        collapsed
    }
}

fn is_title_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ('\u{4e00}'..='\u{9fff}').contains(&ch)
}

// ── Refresh orchestration ───────────────────────────────────────────

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
) -> Result<RefreshOutcome, String> {
    if !force && !should_refresh_predictions(conn, now)? {
        return Ok(RefreshOutcome {
            throttled: true,
            ..RefreshOutcome::default()
        });
    }

    let history = load_history(conn, now, LOOKBACK_DAYS)?;
    if history.len() < MIN_HISTORY_FOR_PREDICTION {
        return Ok(RefreshOutcome::default());
    }

    let suppression = load_suppression(conn, now)?;
    let feedback = load_feedback(conn, now)?;
    let mut predictions = score_candidates(&history, &suppression, &feedback, now);

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    // Stale rows from other algorithm versions never resurface.
    tx.execute(
        "UPDATE pending_predictions
         SET status = 'expired'
         WHERE status IN ('pending', 'notified')
           AND (algorithm_version IS NULL OR algorithm_version != ?1)",
        params![ALGORITHM_VERSION],
    )
    .map_err(|e| e.to_string())?;

    // Reconcile with the live batch: keep persisting candidates in place
    // (preserving status/notified_at so they are not re-notified), expire
    // the ones that dropped out, insert the genuinely new ones.
    let mut existing: HashMap<(String, Option<i64>), i64> = HashMap::new();
    {
        let mut stmt = tx
            .prepare(
                "SELECT id, title_key, project_id
                 FROM pending_predictions
                 WHERE status IN ('pending', 'notified')
                   AND algorithm_version = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![ALGORITHM_VERSION], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (id, title_key, project_id) = row.map_err(|e| e.to_string())?;
            existing.insert((title_key, project_id), id);
        }
    }

    let now_str = format_timestamp(now);
    let mut new_ids = Vec::new();
    let mut kept_ids = Vec::new();

    for prediction in &mut predictions {
        let key = (prediction.title_key.clone(), prediction.project_id);
        if let Some(&id) = existing.get(&key) {
            tx.execute(
                "UPDATE pending_predictions
                 SET title = ?2, reason = ?3, predicted_for_date = ?4,
                     score = ?5, score_breakdown = ?6
                 WHERE id = ?1",
                params![
                    id,
                    prediction.title,
                    prediction.reason,
                    prediction.predicted_for_date,
                    prediction.score,
                    prediction.score_breakdown,
                ],
            )
            .map_err(|e| e.to_string())?;
            prediction.id = id;
            prediction.is_new = false;
            kept_ids.push(id);
        } else {
            tx.execute(
                "INSERT INTO pending_predictions (
                    title, reason, predicted_for_date, created_at, notified_at, status,
                    project_id, title_key, score, score_breakdown, algorithm_version
                 ) VALUES (?1, ?2, ?3, ?4, NULL, 'pending', ?5, ?6, ?7, ?8, ?9)",
                params![
                    prediction.title,
                    prediction.reason,
                    prediction.predicted_for_date,
                    now_str,
                    prediction.project_id,
                    prediction.title_key,
                    prediction.score,
                    prediction.score_breakdown,
                    ALGORITHM_VERSION,
                ],
            )
            .map_err(|e| e.to_string())?;
            let id = tx.last_insert_rowid();
            prediction.id = id;
            prediction.is_new = true;
            new_ids.push(id);
        }
    }

    let live_ids: HashSet<i64> = kept_ids.iter().chain(new_ids.iter()).copied().collect();
    let mut expired = 0usize;
    for &id in existing.values() {
        if !live_ids.contains(&id) {
            tx.execute(
                "UPDATE pending_predictions SET status = 'expired' WHERE id = ?1",
                params![id],
            )
            .map_err(|e| e.to_string())?;
            expired += 1;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    let changed = !new_ids.is_empty() || expired > 0;
    Ok(RefreshOutcome {
        predictions,
        new_ids,
        changed,
        throttled: false,
    })
}

// ── Data loading ────────────────────────────────────────────────────

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
        if parsed < cutoff || parsed > now {
            continue;
        }

        history.push(HistoryEntry {
            title_key: normalize_title_key(&title),
            title,
            project_id,
            created_at: parsed,
        });
    }
    // Mixed timestamp formats (FE ISO vs engine RFC3339) don't sort reliably
    // in SQL; guarantee chronological order here.
    history.sort_by_key(|entry| entry.created_at);

    Ok(history)
}

struct Suppression {
    /// (title_key, project_id) of active todo tasks.
    active_pairs: HashSet<(String, Option<i64>)>,
    /// title_key of active todo tasks regardless of project.
    active_keys_any: HashSet<String>,
    /// title_key of active todo tasks without a project.
    active_keys_no_project: HashSet<String>,
    /// Titles already automated through active recurring rules.
    recurring_keys: HashSet<String>,
    /// Rejected within the feedback window — suppressed across projects.
    rejected_keys: HashSet<String>,
    /// Accepted within the feedback window — suppressed per (key, project).
    accepted_pairs: HashSet<(String, Option<i64>)>,
}

fn load_suppression(conn: &Connection, now: DateTime<Local>) -> Result<Suppression, String> {
    let mut active_pairs = HashSet::new();
    let mut active_keys_any = HashSet::new();
    let mut active_keys_no_project = HashSet::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT title, project_id
                 FROM tasks
                 WHERE deleted_at IS NULL
                   AND status = 'todo'",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<i64>>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (title, project_id) = row.map_err(|e| e.to_string())?;
            let key = normalize_title_key(&title);
            active_keys_any.insert(key.clone());
            if project_id.is_none() {
                active_keys_no_project.insert(key.clone());
            }
            active_pairs.insert((key, project_id));
        }
    }

    let mut recurring_keys = HashSet::new();
    {
        let mut stmt = conn
            .prepare("SELECT title FROM recurring_rules WHERE active = 1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in rows {
            recurring_keys.insert(normalize_title_key(&row.map_err(|e| e.to_string())?));
        }
    }

    let cutoff = format_timestamp(now - Duration::days(RECENT_FEEDBACK_DAYS));
    let mut rejected_keys = HashSet::new();
    let mut accepted_pairs = HashSet::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT title_key, project_id, status
                 FROM pending_predictions
                 WHERE status IN ('accepted', 'rejected')
                   AND COALESCE(actioned_at, created_at) >= ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![cutoff], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (title_key, project_id, status) = row.map_err(|e| e.to_string())?;
            if status == "rejected" {
                rejected_keys.insert(title_key);
            } else {
                accepted_pairs.insert((title_key, project_id));
            }
        }
    }

    Ok(Suppression {
        active_pairs,
        active_keys_any,
        active_keys_no_project,
        recurring_keys,
        rejected_keys,
        accepted_pairs,
    })
}

fn load_feedback(
    conn: &Connection,
    now: DateTime<Local>,
) -> Result<HashMap<(String, Option<i64>), FeedbackStats>, String> {
    // `notified` rows are still live in the UI — they carry no signal yet.
    let mut stmt = conn
        .prepare(
            "SELECT title_key, project_id, status,
                    COALESCE(actioned_at, notified_at, created_at)
             FROM pending_predictions
             WHERE status IN ('accepted', 'rejected', 'expired')",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut feedback: HashMap<(String, Option<i64>), FeedbackStats> = HashMap::new();
    for row in rows {
        let (title_key, project_id, status, at) = row.map_err(|e| e.to_string())?;
        // exp(-days_ago / 14): fresh feedback counts fully, ~30d-old ≈ 0.12.
        let weight = at
            .as_deref()
            .and_then(parse_timestamp)
            .map(|ts| {
                let days = now.signed_duration_since(ts).num_days().max(0) as f64;
                (-days / FEEDBACK_DECAY_DAYS).exp()
            })
            .unwrap_or(0.5);
        let entry = feedback.entry((title_key, project_id)).or_default();
        match status.as_str() {
            "accepted" => entry.accepted += weight,
            "rejected" => entry.rejected += weight,
            "expired" => entry.expired += weight,
            _ => {}
        }
    }

    Ok(feedback)
}

// ── Scoring ─────────────────────────────────────────────────────────

fn median(sorted: &[f64]) -> f64 {
    let n = sorted.len();
    if n == 0 {
        return 0.0;
    }
    if n % 2 == 1 {
        sorted[n / 2]
    } else {
        (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0
    }
}

fn clamp01(x: f64) -> f64 {
    x.clamp(0.0, 1.0)
}

/// Laplace-smoothed lift vs a uniform baseline, squashed to [0, 1] via
/// clamp(log2(lift) / 2): lift 1 → 0 (no signal), lift ≥ 4 → 1.
fn lift_affinity(matches: usize, total: usize, baseline: f64, categories: f64) -> f64 {
    if total == 0 || baseline <= 0.0 {
        return 0.0;
    }
    let p = (matches as f64 + 1.0) / (total as f64 + categories);
    let lift = p / baseline;
    clamp01(lift.log2() / 2.0)
}

fn score_candidates(
    history: &[HistoryEntry],
    suppression: &Suppression,
    feedback: &HashMap<(String, Option<i64>), FeedbackStats>,
    now: DateTime<Local>,
) -> Vec<GeneratedPrediction> {
    let Some(last_entry) = history.last() else {
        return Vec::new();
    };
    let last_key = last_entry.title_key.clone();
    let today = now.date_naive();
    let current_bucket = time_bucket_for_hour(now.hour());

    // Group occurrences by (title_key, project_id).
    struct Group {
        title: String,
        last_occurrence: DateTime<Local>,
        occurrences: Vec<DateTime<Local>>,
    }
    let mut groups: HashMap<(String, Option<i64>), Group> = HashMap::new();
    for entry in history {
        let key = (entry.title_key.clone(), entry.project_id);
        let group = groups.entry(key).or_insert_with(|| Group {
            title: entry.title.clone(),
            last_occurrence: entry.created_at,
            occurrences: Vec::new(),
        });
        group.occurrences.push(entry.created_at);
        if entry.created_at >= group.last_occurrence {
            group.last_occurrence = entry.created_at;
            group.title = entry.title.clone();
        }
    }

    // Transitions: how often an entry of `last_key` is followed shortly by
    // an entry of the candidate's key.
    let mut transition_counts: HashMap<(String, Option<i64>), usize> = HashMap::new();
    for window in history.windows(2) {
        let (previous, next) = (&window[0], &window[1]);
        if previous.title_key == last_key
            && next
                .created_at
                .signed_duration_since(previous.created_at)
                .num_hours()
                <= TRANSITION_WINDOW_HOURS
        {
            *transition_counts
                .entry((next.title_key.clone(), next.project_id))
                .or_insert(0) += 1;
        }
    }

    // Projects with history in the last 7 days.
    let active_projects: HashSet<i64> = history
        .iter()
        .filter(|entry| now.signed_duration_since(entry.created_at).num_days() <= 7)
        .filter_map(|entry| entry.project_id)
        .collect();

    let mut candidates: Vec<CandidateFeatures> = Vec::new();

    for ((title_key, project_id), group) in groups {
        // ── Hard suppression ──
        let suppressed_by_active = suppression
            .active_pairs
            .contains(&(title_key.clone(), project_id))
            || suppression.active_keys_no_project.contains(&title_key)
            || (project_id.is_none() && suppression.active_keys_any.contains(&title_key));
        if suppressed_by_active
            || suppression.recurring_keys.contains(&title_key)
            || suppression.rejected_keys.contains(&title_key)
            || suppression
                .accepted_pairs
                .contains(&(title_key.clone(), project_id))
        {
            continue;
        }

        let days_since_last = now
            .signed_duration_since(group.last_occurrence)
            .num_hours()
            .max(0) as f64
            / 24.0;
        if days_since_last < MIN_DAYS_SINCE_LAST {
            continue;
        }

        // ── Cadence ──
        let mut dates: Vec<NaiveDate> = group
            .occurrences
            .iter()
            .map(|at| at.date_naive())
            .collect();
        dates.sort();
        dates.dedup();
        let distinct_days = dates.len();

        let mut gaps: Vec<f64> = dates
            .windows(2)
            .map(|pair| (pair[1] - pair[0]).num_days() as f64)
            .collect();
        gaps.sort_by(|a, b| a.total_cmp(b));

        let (median_gap, regularity, sigma) = match gaps.len() {
            0 => (None, 0.0, 0.0),
            1 => (Some(gaps[0]), 0.4, 0.5),
            _ => {
                let m = median(&gaps);
                let mut deviations: Vec<f64> = gaps.iter().map(|g| (g - m).abs()).collect();
                deviations.sort_by(|a, b| a.total_cmp(b));
                let mad = median(&deviations);
                let rel = if m > 0.0 { mad / m } else { 1.0 };
                (Some(m), 1.0 / (1.0 + rel), rel.max(0.25))
            }
        };

        // ── Dueness + target date ──
        let mut dueness = 0.0;
        let mut target_date = today;
        match median_gap {
            Some(m) if m >= 0.75 => {
                let ratio = days_since_last / m;
                if ratio < NOT_DUE_RATIO {
                    continue; // far from due — don't even consider
                }
                if ratio >= 0.85 {
                    // Due now or overdue: Gaussian peak at ratio=1 plus a
                    // slowly-decaying overdue tail so weekly tasks resurface.
                    let peak = (-((ratio - 1.0).powi(2)) / (2.0 * sigma * sigma)).exp();
                    let tail = if ratio > 1.0 {
                        0.6 * (-(days_since_last - m) / (2.0 * m).max(3.0)).exp()
                    } else {
                        0.0
                    };
                    dueness = peak.max(tail);
                } else {
                    // Not due yet — but maybe due within the horizon.
                    let due_in = m - days_since_last;
                    if due_in > PREDICT_HORIZON_DAYS {
                        continue;
                    }
                    let due_date = group.last_occurrence.date_naive()
                        + Duration::days(m.round().max(1.0) as i64);
                    target_date = due_date.max(today + Duration::days(1));
                    dueness = 0.85_f64.powf(due_in.max(0.0));
                }
            }
            _ => {
                // No usable cadence: legacy fixed suppression window.
                if days_since_last < IRREGULAR_SUPPRESS_DAYS {
                    continue;
                }
            }
        }

        // ── Bounded features ──
        let freq_strength = distinct_days as f64 / (distinct_days as f64 + 4.0);
        let recency = (-days_since_last / 21.0).exp();

        let target_dow = weekday_name(target_date.weekday());
        let dow_matches = group
            .occurrences
            .iter()
            .filter(|at| weekday_name(at.weekday()) == target_dow)
            .count();
        let dow_affinity = lift_affinity(dow_matches, group.occurrences.len(), 1.0 / 7.0, 7.0);

        // Bucket affinity only applies to "due today, due now" predictions.
        let bucket_affinity = if target_date == today {
            let bucket_matches = group
                .occurrences
                .iter()
                .filter(|at| time_bucket_for_hour(at.hour()) == current_bucket)
                .count();
            lift_affinity(
                bucket_matches,
                group.occurrences.len(),
                time_bucket_width_hours(current_bucket) / 24.0,
                6.0,
            )
        } else {
            0.0
        };

        let transitions = transition_counts
            .get(&(title_key.clone(), project_id))
            .copied()
            .unwrap_or(0) as f64;
        let transition = transitions / (transitions + 2.0);

        let active_project = match project_id {
            Some(id) if active_projects.contains(&id) => 1.0,
            _ => 0.0,
        };

        let feedback_raw = feedback
            .get(&(title_key.clone(), project_id))
            .map(|stats| stats.accepted * 1.2 - stats.rejected * 2.0 - stats.expired * 0.3)
            .unwrap_or(0.0);
        let feedback_feature = feedback_raw.tanh();

        let score = W_DUENESS * dueness
            + W_REGULARITY * regularity
            + W_FREQUENCY * freq_strength
            + W_DOW * dow_affinity
            + W_BUCKET * bucket_affinity
            + W_TRANSITION * transition
            + W_RECENCY * recency
            + W_ACTIVE_PROJECT * active_project
            + W_FEEDBACK * feedback_feature;

        if score < SCORE_THRESHOLD {
            continue;
        }

        candidates.push(CandidateFeatures {
            title: group.title,
            title_key,
            project_id,
            distinct_days,
            median_gap,
            regularity,
            days_since_last,
            dueness,
            target_date,
            dow_affinity,
            bucket_affinity,
            transition,
            recency,
            active_project,
            feedback: feedback_feature,
            score,
        });
    }

    candidates.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.title.cmp(&right.title))
    });

    // One slot per habit: the same title_key in two projects must not
    // occupy two of the few prediction slots.
    let mut seen_keys: HashSet<String> = HashSet::new();
    let mut predictions = Vec::new();
    for candidate in candidates {
        if !seen_keys.insert(candidate.title_key.clone()) {
            continue;
        }
        let reason = build_reason(&candidate, today);
        let score_breakdown = json!({
            "dueness": candidate.dueness,
            "regularity": candidate.regularity,
            "freqStrength": candidate.distinct_days as f64
                / (candidate.distinct_days as f64 + 4.0),
            "dowAffinity": candidate.dow_affinity,
            "bucketAffinity": candidate.bucket_affinity,
            "transition": candidate.transition,
            "recency": candidate.recency,
            "activeProject": candidate.active_project,
            "feedback": candidate.feedback,
            "medianGapDays": candidate.median_gap,
            "daysSinceLast": candidate.days_since_last,
            "distinctDays": candidate.distinct_days,
        })
        .to_string();

        predictions.push(GeneratedPrediction {
            id: 0,
            title: candidate.title,
            title_key: candidate.title_key,
            project_id: candidate.project_id,
            predicted_for_date: candidate.target_date.format("%Y-%m-%d").to_string(),
            score: candidate.score,
            score_breakdown,
            reason,
            is_new: true,
        });
        if predictions.len() >= MAX_PREDICTIONS {
            break;
        }
    }

    predictions
}

fn build_reason(candidate: &CandidateFeatures, today: NaiveDate) -> String {
    let target_dow = weekday_name(candidate.target_date.weekday());

    if candidate.target_date > today {
        return format!(
            "按你的节奏，预计{}（{}）会需要这个任务",
            candidate.target_date.format("%m月%d日"),
            target_dow
        );
    }

    if let Some(gap) = candidate.median_gap {
        let overdue = candidate.days_since_last - gap;
        if candidate.regularity >= 0.55 {
            if (5.5..=8.5).contains(&gap) {
                if overdue > gap * 0.3 {
                    return format!(
                        "这个任务通常每周一次，这次已经晚了{:.0}天",
                        overdue.max(1.0)
                    );
                }
                if candidate.dow_affinity >= 0.5 {
                    return format!("过去几周你常在{}创建这个任务，今天正是时候", target_dow);
                }
                return "这个任务大约每周出现一次，现在到了下一轮".to_string();
            }
            if (0.75..1.5).contains(&gap) {
                return "你几乎每天都会创建这个任务".to_string();
            }
            if (26.0..=35.0).contains(&gap) {
                return "这个任务大约每月出现一次，按节奏该安排了".to_string();
            }
            if overdue > gap * 0.3 {
                return format!(
                    "这个任务平均每{:.0}天一次，这次已经超期{:.0}天",
                    gap,
                    overdue.max(1.0)
                );
            }
            return format!("这个任务平均每{:.0}天出现一次，现在临近下一次", gap);
        }
    }

    if candidate.transition >= 0.3 {
        return "你最近创建类似任务后，常会接着创建它".to_string();
    }
    if candidate.distinct_days >= 3 {
        return "这个任务在你的记录里反复出现".to_string();
    }
    "这是你近期重复创建过的任务".to_string()
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Local, TimeZone};
    use rusqlite::Connection;

    use super::{normalize_title_key, refresh_predictions, ALGORITHM_VERSION};
    use crate::db::run_migrations;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        run_migrations(&conn).expect("run migrations");
        conn
    }

    fn insert_history(conn: &Connection, title: &str, project_id: i64, at: &str) {
        let parsed = super::parse_timestamp(at).expect("valid test timestamp");
        conn.execute(
            "INSERT INTO task_creation_history (task_title, project_id, created_at, dow, hour, day_of_month, is_recurring_instance)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
            rusqlite::params![
                title,
                project_id,
                at,
                super::weekday_name(chrono::Datelike::weekday(&parsed)),
                chrono::Timelike::hour(&parsed) as i64,
                chrono::Datelike::day(&parsed) as i64,
            ],
        )
        .expect("insert history");
    }

    #[test]
    fn normalizes_common_creation_prefixes() {
        assert_eq!(normalize_title_key("创建 本周计划"), "本周计划");
        assert_eq!(normalize_title_key("添加 周复盘"), "周复盘");
    }

    #[test]
    fn normalizes_verb_prefixes() {
        assert_eq!(normalize_title_key("写周报"), "周报");
        assert_eq!(normalize_title_key("完成 代码审查"), "代码审查");
        assert_eq!(normalize_title_key("整理收集箱"), "收集箱");
    }

    #[test]
    fn digit_runs_collapse_into_one_key() {
        assert_eq!(normalize_title_key("3月总结"), normalize_title_key("4月总结"));
        assert_eq!(
            normalize_title_key("第3章笔记"),
            normalize_title_key("第12章笔记")
        );
        assert_ne!(normalize_title_key("月总结"), normalize_title_key("周总结"));
    }

    #[test]
    fn generates_predictions_from_weekly_cadence() {
        let conn = setup_db();
        // Mar 30 2026 is a Monday.
        let now = Local
            .with_ymd_and_hms(2026, 3, 30, 9, 0, 0)
            .single()
            .expect("valid timestamp");

        for day in [2, 9, 16, 23] {
            insert_history(
                &conn,
                "本周计划",
                1,
                &format!("2026-03-{day:02}T09:00:00+08:00"),
            );
        }
        for day in [3, 10, 17] {
            insert_history(
                &conn,
                "整理收集箱",
                1,
                &format!("2026-03-{day:02}T18:00:00+08:00"),
            );
        }

        let outcome = refresh_predictions(&conn, now, true).expect("refresh predictions");

        assert!(!outcome.predictions.is_empty());
        assert_eq!(outcome.predictions[0].title, "本周计划");
        assert_eq!(outcome.predictions[0].project_id, Some(1));
        assert!(outcome.predictions[0].score >= 38.0);
        assert_eq!(outcome.predictions[0].predicted_for_date, "2026-03-30");
        assert_eq!(outcome.new_ids.len(), outcome.predictions.len());
    }

    #[test]
    fn weekly_task_not_due_yet_is_suppressed() {
        let conn = setup_db();
        // Last occurrence yesterday on a strict weekly cadence → not due.
        let now = Local
            .with_ymd_and_hms(2026, 3, 24, 9, 0, 0)
            .single()
            .expect("valid timestamp");

        for day in [2, 9, 16, 23] {
            insert_history(
                &conn,
                "本周计划",
                1,
                &format!("2026-03-{day:02}T09:00:00+08:00"),
            );
        }

        let outcome = refresh_predictions(&conn, now, true).expect("refresh predictions");
        assert!(outcome
            .predictions
            .iter()
            .all(|p| p.title_key != normalize_title_key("本周计划")));
    }

    #[test]
    fn upcoming_weekly_task_predicts_future_date() {
        let conn = setup_db();
        // Saturday Mar 28: weekly Monday task is due in 2 days (within horizon).
        let now = Local
            .with_ymd_and_hms(2026, 3, 28, 10, 0, 0)
            .single()
            .expect("valid timestamp");

        for day in [2, 9, 16, 23] {
            insert_history(
                &conn,
                "本周计划",
                1,
                &format!("2026-03-{day:02}T09:00:00+08:00"),
            );
        }
        // Filler history so MIN_HISTORY_FOR_PREDICTION (7) is met.
        for day in [5, 12, 19] {
            insert_history(
                &conn,
                "整理收集箱",
                1,
                &format!("2026-03-{day:02}T18:00:00+08:00"),
            );
        }

        let outcome = refresh_predictions(&conn, now, true).expect("refresh predictions");
        let plan = outcome
            .predictions
            .iter()
            .find(|p| p.title == "本周计划")
            .expect("weekly task predicted ahead of time");
        assert_eq!(plan.predicted_for_date, "2026-03-30");
    }

    #[test]
    fn suppresses_predictions_when_same_title_is_still_active() {
        let conn = setup_db();
        let now = Local
            .with_ymd_and_hms(2026, 3, 30, 9, 0, 0)
            .single()
            .expect("valid timestamp");

        for day in [2, 9, 16, 23] {
            insert_history(
                &conn,
                "本周计划",
                1,
                &format!("2026-03-{day:02}T09:00:00+08:00"),
            );
        }
        for day in [3, 10, 17] {
            insert_history(
                &conn,
                "整理收集箱",
                1,
                &format!("2026-03-{day:02}T18:00:00+08:00"),
            );
        }

        conn.execute(
            "INSERT INTO tasks (title, status, project_id, created_at, updated_at)
             VALUES ('本周计划', 'todo', 1, '2026-03-30 08:00:00', '2026-03-30 08:00:00')",
            [],
        )
        .expect("insert active task");

        let outcome = refresh_predictions(&conn, now, true).expect("refresh predictions");
        assert!(outcome
            .predictions
            .iter()
            .all(|prediction| prediction.title != "本周计划"));
    }

    #[test]
    fn suppresses_candidates_with_recent_rejection() {
        let conn = setup_db();
        let now = Local
            .with_ymd_and_hms(2026, 3, 30, 9, 0, 0)
            .single()
            .expect("valid timestamp");

        for day in [2, 9, 16, 23] {
            insert_history(
                &conn,
                "本周计划",
                1,
                &format!("2026-03-{day:02}T09:00:00+08:00"),
            );
        }

        // User rejected this title 3 days ago → suppressed this round.
        conn.execute(
            "INSERT INTO pending_predictions
               (title, predicted_for_date, created_at, actioned_at, status, project_id, title_key, algorithm_version)
             VALUES ('本周计划', '2026-03-27', '2026-03-27T09:00:00+08:00', '2026-03-27T09:30:00+08:00', 'rejected', 1, ?1, ?2)",
            rusqlite::params![normalize_title_key("本周计划"), ALGORITHM_VERSION],
        )
        .expect("insert rejection feedback");

        let outcome = refresh_predictions(&conn, now, true).expect("refresh predictions");
        assert!(outcome
            .predictions
            .iter()
            .all(|prediction| prediction.title_key != normalize_title_key("本周计划")));
    }

    #[test]
    fn suppresses_titles_automated_by_recurring_rules() {
        let conn = setup_db();
        let now = Local
            .with_ymd_and_hms(2026, 3, 30, 9, 0, 0)
            .single()
            .expect("valid timestamp");

        for day in [2, 9, 16, 23] {
            insert_history(
                &conn,
                "本周计划",
                1,
                &format!("2026-03-{day:02}T09:00:00+08:00"),
            );
        }
        for day in [5, 12, 19] {
            insert_history(
                &conn,
                "整理收集箱",
                1,
                &format!("2026-03-{day:02}T18:00:00+08:00"),
            );
        }

        conn.execute(
            "INSERT INTO recurring_rules (title, repeat_type, anchor_date, active)
             VALUES ('本周计划', 'weekly', '2026-03-02', 1)",
            [],
        )
        .expect("insert recurring rule");

        let outcome = refresh_predictions(&conn, now, true).expect("refresh predictions");
        assert!(outcome
            .predictions
            .iter()
            .all(|p| p.title_key != normalize_title_key("本周计划")));
    }

    #[test]
    fn reconcile_keeps_persisting_rows_and_reports_only_new_ids() {
        let conn = setup_db();
        let now = Local
            .with_ymd_and_hms(2026, 3, 30, 9, 0, 0)
            .single()
            .expect("valid timestamp");

        for day in [2, 9, 16, 23] {
            insert_history(
                &conn,
                "本周计划",
                1,
                &format!("2026-03-{day:02}T09:00:00+08:00"),
            );
        }
        for day in [5, 12, 19] {
            insert_history(
                &conn,
                "整理收集箱",
                1,
                &format!("2026-03-{day:02}T18:00:00+08:00"),
            );
        }

        let first = refresh_predictions(&conn, now, true).expect("first refresh");
        assert!(!first.new_ids.is_empty());
        let first_id = first.predictions[0].id;

        // Simulate the row having been notified in the meantime.
        conn.execute(
            "UPDATE pending_predictions SET status = 'notified', notified_at = ?2 WHERE id = ?1",
            rusqlite::params![first_id, super::format_timestamp(now)],
        )
        .expect("mark notified");

        let second =
            refresh_predictions(&conn, now + Duration::hours(2), true).expect("second refresh");
        let persisted = second
            .predictions
            .iter()
            .find(|p| p.id == first_id)
            .expect("row persisted across refresh");
        assert!(!persisted.is_new);
        assert!(!second.new_ids.contains(&first_id));

        // The notified status must survive the reconcile.
        let status: String = conn
            .query_row(
                "SELECT status FROM pending_predictions WHERE id = ?1",
                rusqlite::params![first_id],
                |row| row.get(0),
            )
            .expect("read status");
        assert_eq!(status, "notified");
    }

    #[test]
    fn same_habit_across_projects_takes_one_slot() {
        let conn = setup_db();
        let now = Local
            .with_ymd_and_hms(2026, 3, 30, 9, 0, 0)
            .single()
            .expect("valid timestamp");

        conn.execute(
            "INSERT INTO projects (id, title, color, icon) VALUES (2, '工作', '#3b82f6', 'work')",
            [],
        )
        .expect("seed second project");

        for day in [2, 9, 16, 23] {
            insert_history(
                &conn,
                "周报",
                1,
                &format!("2026-03-{day:02}T09:00:00+08:00"),
            );
            insert_history(
                &conn,
                "周报",
                2,
                &format!("2026-03-{day:02}T10:00:00+08:00"),
            );
        }

        let outcome = refresh_predictions(&conn, now, true).expect("refresh predictions");
        let weekly_reports = outcome
            .predictions
            .iter()
            .filter(|p| p.title_key == normalize_title_key("周报"))
            .count();
        assert_eq!(weekly_reports, 1);
    }
}
