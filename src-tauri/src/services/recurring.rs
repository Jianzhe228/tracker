use chrono::NaiveDate;
use rusqlite::Connection;

struct RecurringRule {
    id: i64,
    title: String,
    priority: i64,
    project_id: Option<i64>,
    repeat_type: String,
    repeat_days: Option<String>,
    anchor_date: String,
    reminder_time: Option<String>,
    notes: Option<String>,
    pomodoro_count: i64,
    pomodoro_duration: i64,
    last_generated_date: Option<String>,
}

/// Calculate the safe day for monthly recurrence.
/// e.g. anchor_day=31, February → 28 or 29.
fn safe_month_day(year: i32, month: u32, target_day: u32) -> u32 {
    let days_in_month = NaiveDate::from_ymd_opt(
        if month == 12 { year + 1 } else { year },
        if month == 12 { 1 } else { month + 1 },
        1,
    )
    .unwrap()
    .signed_duration_since(NaiveDate::from_ymd_opt(year, month, 1).unwrap())
    .num_days() as u32;

    target_day.min(days_in_month)
}

/// Check whether `date` matches the given recurring rule.
fn matches_rule(date: NaiveDate, rule: &RecurringRule) -> bool {
    let anchor = match NaiveDate::parse_from_str(&rule.anchor_date, "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => return false,
    };

    match rule.repeat_type.as_str() {
        "daily" => true,
        "weekdays" => {
            let wd = date.weekday().num_days_from_monday(); // 0=Mon..6=Sun
            wd < 5
        }
        "weekly" => date.weekday() == anchor.weekday(),
        "monthly" => {
            let target_day = safe_month_day(date.year(), date.month(), anchor.day());
            date.day() == target_day
        }
        "custom" => {
            if let Some(ref days_str) = rule.repeat_days {
                let weekday = date.weekday().num_days_from_monday(); // 0=Mon..6=Sun
                                                                     // repeat_days is a JSON array like "[1,3,5]" where 1=Mon..7=Sun
                                                                     // Parse it manually to avoid serde_json dependency in this module
                days_str
                    .trim_matches(|c| c == '[' || c == ']')
                    .split(',')
                    .filter_map(|s| s.trim().parse::<u32>().ok())
                    .any(|d| {
                        // Convert 1-based (1=Mon..7=Sun) to 0-based (0=Mon..6=Sun)
                        d.wrapping_sub(1) == weekday
                    })
            } else {
                false
            }
        }
        _ => false,
    }
}

use chrono::Datelike;

/// Generate missing task instances for all active recurring rules.
/// Should be called once at app startup (in app_init).
pub fn generate_recurring_tasks(conn: &Connection, today: &str) -> Result<(), String> {
    let today_date = NaiveDate::parse_from_str(today, "%Y-%m-%d")
        .map_err(|e| format!("invalid today date: {}", e))?;

    // Fetch all active rules
    let mut stmt = conn
        .prepare(
            "SELECT id, title, priority, project_id, repeat_type, repeat_days,
              anchor_date, reminder_time, notes, pomodoro_count, pomodoro_duration,
              last_generated_date
       FROM recurring_rules
       WHERE active = 1",
        )
        .map_err(|e| e.to_string())?;

    let rules: Vec<RecurringRule> = stmt
        .query_map([], |row| {
            Ok(RecurringRule {
                id: row.get(0)?,
                title: row.get(1)?,
                priority: row.get(2)?,
                project_id: row.get(3)?,
                repeat_type: row.get(4)?,
                repeat_days: row.get(5)?,
                anchor_date: row.get(6)?,
                reminder_time: row.get(7)?,
                notes: row.get(8)?,
                pomodoro_count: row.get(9)?,
                pomodoro_duration: row.get(10)?,
                last_generated_date: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    if rules.is_empty() {
        return Ok(());
    }

    let rule_ids: Vec<i64> = rules.iter().map(|r| r.id).collect();

    // Batch fetch all existing (non-deleted) tasks for these rules. We derive two things:
    //   1. existing_set: (rule_id, due_at) pairs → dedup so the same day is never created twice.
    //   2. open_rule_ids: rules that still have an unfinished (status = 'todo') instance.
    //      A daily task left incomplete must NOT spawn a second copy the next day — the next
    //      occurrence is only generated once the current instance is done/cancelled.
    let mut existing_set: std::collections::HashSet<(i64, String)> =
        std::collections::HashSet::new();
    let mut open_rule_ids: std::collections::HashSet<i64> = std::collections::HashSet::new();
    {
        let placeholders: String = rule_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT recurring_rule_id, due_at, status FROM tasks
       WHERE recurring_rule_id IN ({}) AND deleted_at IS NULL",
            placeholders
        );
        let mut check_stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let mut rows = check_stmt
            .query_map(rusqlite::params_from_iter(rule_ids.iter()), |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        while let Some((rule_id, due_at, status)) =
            rows.next().transpose().map_err(|e| e.to_string())?
        {
            if status == "todo" {
                open_rule_ids.insert(rule_id);
            }
            if let Some(due) = due_at {
                existing_set.insert((rule_id, due));
            }
        }
    }

    // Collect all tasks to insert
    let mut tasks_to_insert: Vec<(i64, String)> = Vec::new(); // (rule_id, due_at)

    for rule in &rules {
        // Skip rules that still have an unfinished instance: don't stack a new copy on top
        // of an incomplete one (the duplicate-daily-task bug). last_generated_date is still
        // advanced for every rule below, so once the open instance is completed the next
        // occurrence resumes from today without backfilling the skipped days.
        if open_rule_ids.contains(&rule.id) {
            continue;
        }

        let start_date = if let Some(ref last) = rule.last_generated_date {
            match NaiveDate::parse_from_str(last, "%Y-%m-%d") {
                Ok(d) => d.succ_opt().unwrap_or(d),
                Err(_) => today_date,
            }
        } else {
            // First generation: start from anchor_date, but not before today
            match NaiveDate::parse_from_str(&rule.anchor_date, "%Y-%m-%d") {
                Ok(anchor) => {
                    if anchor > today_date {
                        continue; // anchor is in the future, skip
                    }
                    anchor
                }
                Err(_) => continue,
            }
        };

        let mut current = start_date;
        while current <= today_date {
            if matches_rule(current, rule) {
                let date_str = current.format("%Y-%m-%d").to_string();
                if !existing_set.contains(&(rule.id, date_str.clone())) {
                    tasks_to_insert.push((rule.id, date_str));
                }
            }
            current = match current.succ_opt() {
                Some(next) => next,
                None => break,
            };
        }
    }

    // Batch insert all tasks
    if !tasks_to_insert.is_empty() {
        let now = chrono::Local::now()
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string();
        let mut insert_stmt = conn
      .prepare(
        "INSERT INTO tasks (title, status, priority, project_id, due_at, reminder_time, notes, pomodoro_count, pomodoro_duration, sort_order, recurring_rule_id, created_at, updated_at)
         SELECT ?1, 'todo', ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10, ?10
         WHERE NOT EXISTS (
           SELECT 1 FROM tasks WHERE recurring_rule_id = ?9 AND due_at = ?4 AND deleted_at IS NULL
         )",
      )
      .map_err(|e| e.to_string())?;

        for &(rule_id, ref due_at) in &tasks_to_insert {
            let rule = rules.iter().find(|r| r.id == rule_id).unwrap();
            insert_stmt
                .execute(rusqlite::params![
                    rule.title,
                    rule.priority,
                    rule.project_id,
                    due_at,
                    rule.reminder_time,
                    rule.notes,
                    rule.pomodoro_count,
                    rule.pomodoro_duration,
                    rule_id,
                    now,
                ])
                .map_err(|e| format!("failed to insert recurring task: {}", e))?;
        }
    }

    // Batch update last_generated_date for all rules
    let mut update_stmt = conn
    .prepare(
      "UPDATE recurring_rules SET last_generated_date = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
    )
    .map_err(|e| e.to_string())?;
    for rule in &rules {
        update_stmt
            .execute(rusqlite::params![today, rule.id])
            .map_err(|e| format!("failed to update last_generated_date: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::generate_recurring_tasks;
    use crate::db::run_migrations;
    use rusqlite::Connection;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        run_migrations(&conn).expect("run migrations");
        conn
    }

    fn insert_daily_rule(conn: &Connection, title: &str, anchor: &str) -> i64 {
        conn.execute(
            "INSERT INTO recurring_rules (title, repeat_type, anchor_date, active)
             VALUES (?1, 'daily', ?2, 1)",
            rusqlite::params![title, anchor],
        )
        .expect("insert rule");
        conn.last_insert_rowid()
    }

    fn open_task_count(conn: &Connection, rule_id: i64) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM tasks
             WHERE recurring_rule_id = ?1 AND status = 'todo' AND deleted_at IS NULL",
            rusqlite::params![rule_id],
            |row| row.get(0),
        )
        .expect("count open tasks")
    }

    fn total_task_count(conn: &Connection, rule_id: i64) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM tasks
             WHERE recurring_rule_id = ?1 AND deleted_at IS NULL",
            rusqlite::params![rule_id],
            |row| row.get(0),
        )
        .expect("count tasks")
    }

    fn complete_all(conn: &Connection, rule_id: i64) {
        conn.execute(
            "UPDATE tasks SET status = 'done', completed_at = '2026-06-29T20:00:00Z'
             WHERE recurring_rule_id = ?1 AND deleted_at IS NULL",
            rusqlite::params![rule_id],
        )
        .expect("complete tasks");
    }

    #[test]
    fn daily_rule_does_not_duplicate_while_previous_is_incomplete() {
        let conn = setup_db();
        let rule = insert_daily_rule(&conn, "阅读", "2026-06-29");

        // Day 1: the first instance is created.
        generate_recurring_tasks(&conn, "2026-06-29").expect("gen day1");
        assert_eq!(open_task_count(&conn, rule), 1, "day1 creates one instance");

        // Day 2: the day-1 task is still open → no new instance should be created.
        generate_recurring_tasks(&conn, "2026-06-30").expect("gen day2");
        assert_eq!(
            open_task_count(&conn, rule),
            1,
            "an incomplete daily task must not spawn a duplicate the next day"
        );
        assert_eq!(total_task_count(&conn, rule), 1);
    }

    #[test]
    fn daily_rule_resumes_after_completion() {
        let conn = setup_db();
        let rule = insert_daily_rule(&conn, "阅读", "2026-06-29");

        generate_recurring_tasks(&conn, "2026-06-29").expect("gen day1");
        complete_all(&conn, rule);

        // Next day: no open instance → a fresh one is generated.
        generate_recurring_tasks(&conn, "2026-06-30").expect("gen day2");
        assert_eq!(
            open_task_count(&conn, rule),
            1,
            "completing the instance lets the next day generate again"
        );
        assert_eq!(total_task_count(&conn, rule), 2, "one done + one new todo");
    }

    #[test]
    fn no_backfill_after_skipping_incomplete_days() {
        let conn = setup_db();
        let rule = insert_daily_rule(&conn, "阅读", "2026-06-29");

        generate_recurring_tasks(&conn, "2026-06-29").expect("gen day1");
        // Several days pass while the first instance stays open.
        generate_recurring_tasks(&conn, "2026-06-30").expect("gen day2");
        generate_recurring_tasks(&conn, "2026-07-01").expect("gen day3");
        generate_recurring_tasks(&conn, "2026-07-02").expect("gen day4");
        assert_eq!(open_task_count(&conn, rule), 1, "still a single open instance");

        // Complete it, then run the next day: exactly one fresh instance — the skipped
        // 06-30 / 07-01 / 07-02 days are NOT backfilled.
        complete_all(&conn, rule);
        generate_recurring_tasks(&conn, "2026-07-03").expect("gen day5");
        assert_eq!(open_task_count(&conn, rule), 1, "exactly one fresh instance");
        assert_eq!(
            total_task_count(&conn, rule),
            2,
            "one done + one new; skipped days are not backfilled"
        );
    }
}
