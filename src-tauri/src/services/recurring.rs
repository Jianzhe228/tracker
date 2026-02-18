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
  let today_date =
    NaiveDate::parse_from_str(today, "%Y-%m-%d").map_err(|e| format!("invalid today date: {}", e))?;

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

  for rule in &rules {
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

        // Check for duplicate: same rule + same due_at date
        let exists: bool = conn
          .query_row(
            "SELECT COUNT(*) > 0 FROM tasks WHERE recurring_rule_id = ?1 AND due_at = ?2 AND deleted_at IS NULL",
            rusqlite::params![rule.id, date_str],
            |row| row.get(0),
          )
          .unwrap_or(false);

        if !exists {
          let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
          conn
            .execute(
              "INSERT INTO tasks (title, status, priority, project_id, due_at, reminder_time, notes, pomodoro_count, pomodoro_duration, sort_order, recurring_rule_id, created_at, updated_at)
               VALUES (?1, 'todo', ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10, ?10)",
              rusqlite::params![
                rule.title,
                rule.priority,
                rule.project_id,
                date_str,
                rule.reminder_time,
                rule.notes,
                rule.pomodoro_count,
                rule.pomodoro_duration,
                rule.id,
                now,
              ],
            )
            .map_err(|e| format!("failed to insert recurring task: {}", e))?;
        }
      }
      current = match current.succ_opt() {
        Some(next) => next,
        None => break,
      };
    }

    // Update last_generated_date
    conn
      .execute(
        "UPDATE recurring_rules SET last_generated_date = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        rusqlite::params![today, rule.id],
      )
      .map_err(|e| format!("failed to update last_generated_date: {}", e))?;
  }

  Ok(())
}
