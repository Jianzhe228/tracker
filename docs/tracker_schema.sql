-- Tracker database schema export
-- Source DB: /home/zjz/.local/share/com.zjz.tracker/tracker.db
-- Exported at: 2026-02-18T14:47:20+08:00
-- Updated at: 2026-02-18 (V3: recurring_rules + tasks.recurring_rule_id)
PRAGMA user_version = 3;

CREATE TABLE user_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    color TEXT,
    icon TEXT,
    parent_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES projects(id) ON DELETE SET NULL
);
CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE recurring_rules (
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
CREATE TABLE tasks (
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
    recurring_rule_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (recurring_rule_id) REFERENCES recurring_rules(id) ON DELETE SET NULL
);
CREATE TABLE task_tags (
    task_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (task_id, tag_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE TABLE focus_sessions (
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
CREATE TABLE ai_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_type TEXT NOT NULL,
    context TEXT,
    suggestion TEXT NOT NULL,
    user_action TEXT,
    user_feedback TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE notification_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    payload TEXT,
    is_read BOOLEAN DEFAULT 0,
    read_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_notification_logs_created_at ON notification_logs(created_at);
CREATE INDEX idx_notification_logs_type_created_at ON notification_logs(type, created_at);
CREATE INDEX idx_notification_logs_is_read_created_at ON notification_logs(is_read, created_at);
CREATE TABLE task_completion_logs (
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
CREATE TABLE task_deletion_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    task_title TEXT NOT NULL,
    deleted_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE daily_summaries (
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
CREATE TABLE habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    color TEXT,
    type TEXT NOT NULL DEFAULT 'boolean',
    target_value INTEGER DEFAULT 1,
    target_unit TEXT,
    frequency_type TEXT NOT NULL DEFAULT 'daily',
    frequency_value INTEGER,
    frequency_days TEXT,
    max_skips_per_month INTEGER DEFAULT 3,
    linked_to_pomodoro BOOLEAN DEFAULT 0,
    linked_project_id INTEGER,
    linked_tag_id INTEGER,
    reminder_enabled BOOLEAN DEFAULT 0,
    reminder_time TEXT,
    archived BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (linked_project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (linked_tag_id) REFERENCES tags(id) ON DELETE SET NULL
);
CREATE TABLE habit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL,
    check_in_date DATE NOT NULL,
    status TEXT NOT NULL,
    value INTEGER DEFAULT 1,
    skip_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
    UNIQUE (habit_id, check_in_date)
);
CREATE INDEX idx_habit_logs_habit_date ON habit_logs(habit_id, check_in_date);
CREATE INDEX idx_habit_logs_date ON habit_logs(check_in_date);
CREATE TABLE habit_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL UNIQUE,
    current_streak INTEGER DEFAULT 0,
    best_streak INTEGER DEFAULT 0,
    month_completed INTEGER DEFAULT 0,
    month_skipped INTEGER DEFAULT 0,
    month_total INTEGER DEFAULT 0,
    habit_score INTEGER DEFAULT 0,
    total_completed INTEGER DEFAULT 0,
    last_check_in_date DATE,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
);
