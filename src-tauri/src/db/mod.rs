use rusqlite::Connection;
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;
use tauri::Manager;

pub struct AppState {
  app_handle: AppHandle,
  db: OnceLock<Mutex<Connection>>,
}

impl AppState {
  pub fn new(app_handle: AppHandle) -> Self {
    Self {
      app_handle,
      db: OnceLock::new(),
    }
  }

  pub fn db(&self) -> &Mutex<Connection> {
    self.db.get_or_init(|| {
      Mutex::new(init_db(&self.app_handle))
    })
  }
}

fn init_db(app: &AppHandle) -> Connection {
  let app_dir = app
    .path()
    .app_data_dir()
    .expect("failed to resolve app data dir");
  std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");

  let db_path = app_dir.join("tracker.db");
  let conn = Connection::open(&db_path).expect("failed to open database");

  // Enable WAL mode for better concurrency
  conn.execute_batch("PRAGMA journal_mode=WAL;").ok();
  // Enable foreign keys
  conn
    .execute_batch("PRAGMA foreign_keys=ON;")
    .expect("failed to enable foreign keys");

  run_migrations(&conn);

  conn
}

const SCHEMA_V2: &str = "
-- 3.1.1 user_settings
CREATE TABLE IF NOT EXISTS user_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3.1.2 projects
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    color TEXT,
    icon TEXT,
    parent_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- 3.1.3 tags
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3.1.4 tasks
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo',
    priority INTEGER DEFAULT 0,
    project_id INTEGER,
    parent_id INTEGER,
    due_at DATETIME,
    reminder_time DATETIME,
    completed_at DATETIME,
    deleted_at DATETIME,
    notes TEXT,
    pomodoro_count INTEGER DEFAULT 1,
    pomodoro_duration INTEGER DEFAULT 25,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- 3.1.5 task_tags
CREATE TABLE IF NOT EXISTS task_tags (
    task_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (task_id, tag_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- 3.1.6 focus_sessions
CREATE TABLE IF NOT EXISTS focus_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    start_time DATETIME NOT NULL,
    end_time DATETIME,
    duration_seconds INTEGER NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    interruption_reason TEXT,
    pomodoro_count INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

-- 3.1.7 ai_logs
CREATE TABLE IF NOT EXISTS ai_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_type TEXT NOT NULL,
    context TEXT,
    suggestion TEXT NOT NULL,
    user_action TEXT,
    user_feedback TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3.1.7.1 notification_logs
CREATE TABLE IF NOT EXISTS notification_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    payload TEXT,
    is_read BOOLEAN DEFAULT 0,
    read_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON notification_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_notification_logs_type_created_at ON notification_logs(type, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_logs_is_read_created_at ON notification_logs(is_read, created_at);

-- 3.1.8 task_completion_logs
CREATE TABLE IF NOT EXISTS task_completion_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    task_title TEXT NOT NULL,
    estimated_seconds INTEGER NOT NULL,
    actual_seconds INTEGER NOT NULL,
    deviation_percentage REAL,
    deviation_reason TEXT,
    reflection TEXT,
    next_improvement TEXT,
    personal_notes TEXT,
    completed_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- 3.1.9 task_deletion_logs
CREATE TABLE IF NOT EXISTS task_deletion_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    task_title TEXT NOT NULL,
    deleted_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3.1.10 daily_summaries
CREATE TABLE IF NOT EXISTS daily_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    total_focus_seconds INTEGER DEFAULT 0,
    total_pomodoros INTEGER DEFAULT 0,
    tasks_completed INTEGER DEFAULT 0,
    tasks_created INTEGER DEFAULT 0,
    interruptions INTEGER DEFAULT 0,
    hourly_distribution TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
";

fn run_migrations(conn: &Connection) {
  let version: i32 = conn
    .pragma_query_value(None, "user_version", |row| row.get(0))
    .unwrap_or(0);

  if version < 2 {
    // Drop old v1 tables if upgrading from v1
    if version == 1 {
      conn
        .execute_batch(
          "
          DROP TABLE IF EXISTS habit_checks;
          DROP TABLE IF EXISTS habits;
          DROP TABLE IF EXISTS tasks;
          DROP TABLE IF EXISTS settings;
          ",
        )
        .expect("failed to drop old v1 tables");
    }

    // Create all v2 tables
    conn
      .execute_batch(SCHEMA_V2)
      .expect("failed to run migration v2");

    // Insert default project "收集箱" if not exists
    conn
      .execute(
        "INSERT OR IGNORE INTO projects (id, title, color, icon) VALUES (1, '收集箱', '#6b7280', 'inbox')",
        [],
      )
      .expect("failed to insert default project");

    conn
      .execute_batch("PRAGMA user_version = 2;")
      .expect("failed to set user_version");
  }

  if version < 3 {
    conn
      .execute_batch(
        "
        CREATE TABLE IF NOT EXISTS recurring_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            priority INTEGER DEFAULT 0,
            project_id INTEGER,
            repeat_type TEXT NOT NULL,
            repeat_days TEXT,
            anchor_date TEXT NOT NULL,
            reminder_time TEXT,
            notes TEXT,
            pomodoro_count INTEGER DEFAULT 1,
            pomodoro_duration INTEGER DEFAULT 25,
            active BOOLEAN DEFAULT 1,
            last_generated_date TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
        );

        ALTER TABLE tasks ADD COLUMN recurring_rule_id INTEGER
            REFERENCES recurring_rules(id) ON DELETE SET NULL;

        ALTER TABLE tasks DROP COLUMN is_recurring;
        ALTER TABLE tasks DROP COLUMN repeat_rule;

        PRAGMA user_version = 3;
        ",
      )
      .expect("failed to run migration v3");
  }

  if version < 4 {
    conn
      .execute_batch(
        "
        ALTER TABLE tasks DROP COLUMN description;
        ALTER TABLE tasks DROP COLUMN due_at_postpone_count;

        PRAGMA user_version = 4;
        ",
      )
      .expect("failed to run migration v4");
  }

  if version < 5 {
    conn
      .execute_batch(
        "
        DROP TABLE IF EXISTS habit_stats;
        DROP TABLE IF EXISTS habit_logs;
        DROP TABLE IF EXISTS habits;

        PRAGMA user_version = 5;
        ",
      )
      .expect("failed to run migration v5");
  }
}
