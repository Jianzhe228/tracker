#!/usr/bin/env python3
"""Generate realistic fake data for Smart Focus Tracker dashboard testing."""

import random
import sqlite3
import sys
from datetime import datetime, timedelta, date

DB_PATH = sys.argv[1] if len(sys.argv) > 1 else "/home/zjz/.local/share/com.zjz.tracker/tracker.db"

random.seed(42)

# ── Time range: past ~120 days (covers 12+ weeks for weekly charts) ──
TODAY = date(2026, 3, 23)
START_DATE = TODAY - timedelta(days=120)

# ── Projects ──
PROJECTS = [
    ("Smart Tracker 开发", "#3b82f6", "code"),
    ("读书笔记", "#f59e0b", "book"),
    ("健身计划", "#10b981", "heart"),
    ("毕业论文", "#8b5cf6", "document"),
    ("学习 Rust", "#ef4444", "terminal"),
    ("前端重构", "#06b6d4", "layout"),
]

# ── Realistic task titles per project ──
TASK_TITLES = {
    "Smart Tracker 开发": [
        "实现仪表盘热力图", "修复番茄钟计时偏差 bug", "添加任务拖拽排序",
        "优化 SQLite 查询性能", "实现 AI 子任务建议", "添加系统托盘功能",
        "设计统计图表页面", "修复暗色模式样式问题", "实现任务导入导出",
        "添加键盘快捷键支持", "重构状态管理逻辑", "实现每周专注报告",
        "添加多语言支持", "修复 macOS 构建问题", "优化启动速度",
        "实现任务标签功能", "添加自定义番茄时长", "修复窗口最大化图标",
        "实现数据备份恢复", "添加开机自启动", "优化内存占用",
        "实现任务搜索功能", "修复热力图点击事件", "添加统计导出 PDF",
        "重构 Tauri command 层", "实现离线模式",
    ],
    "读书笔记": [
        "读《深入理解计算机系统》第3章", "整理《设计模式》笔记",
        "读《Rust 程序设计语言》ch5-8", "写《代码整洁之道》读后感",
        "读《数据密集型应用系统设计》", "整理本月阅读清单",
        "读《The Pragmatic Programmer》", "写技术博客：Rust 所有权",
        "读《算法导论》动态规划章节", "整理 Vim 操作笔记",
        "读《重构》第二版前5章", "读《HTTP 权威指南》",
        "写读书总结：3月份", "读《程序员修炼之道》",
    ],
    "健身计划": [
        "晨跑 5 公里", "上肢力量训练", "核心训练 30 分钟",
        "游泳 1 小时", "瑜伽拉伸", "HIIT 间歇训练",
        "制定下周训练计划", "记录体重和体脂", "腿部训练日",
        "研究营养补充方案", "跑步机 40 分钟", "引体向上训练",
    ],
    "毕业论文": [
        "撰写绪论章节", "整理参考文献", "画系统架构图",
        "实验数据分析", "写实验部分初稿", "修改导师反馈意见",
        "补充相关工作综述", "准备中期答辩 PPT", "实验结果可视化",
        "校对全文格式", "写摘要和关键词", "完善实验方法描述",
        "对比实验补充", "整理附录材料", "写致谢",
        "论文查重自检", "最终版本修订",
    ],
    "学习 Rust": [
        "练习所有权和借用", "实现链表数据结构", "学习 trait 和泛型",
        "完成 Rustlings 练习", "写一个 CLI 工具", "学习异步编程 tokio",
        "实现简单的 HTTP 服务器", "学习宏编程", "练习错误处理模式",
        "阅读 std 库源码", "实现并发数据结构", "学习 unsafe Rust",
        "完成 Advent of Code 题目", "学习 Serde 序列化",
    ],
    "前端重构": [
        "迁移到 Composition API", "抽取通用组件库", "优化打包体积",
        "添加单元测试覆盖", "实现路由懒加载", "重构表单验证逻辑",
        "统一错误处理中间件", "优化首屏加载速度", "迁移到 Tailwind v4",
        "实现虚拟列表", "重构状态管理", "添加 E2E 测试",
        "CSS 变量统一主题", "组件文档编写",
    ],
}

# ── Helpers ──
def random_time_in_range(d: date, hour_start: int, hour_end: int) -> datetime:
    """Generate a random datetime within a specific hour range on a given date."""
    h = random.randint(hour_start, hour_end)
    m = random.randint(0, 59)
    s = random.randint(0, 59)
    return datetime(d.year, d.month, d.day, h, m, s)

def work_probability(d: date) -> float:
    """Higher probability of activity on weekdays."""
    wd = d.weekday()
    if wd < 5:  # Mon-Fri
        return 0.85
    elif wd == 5:  # Saturday
        return 0.5
    else:  # Sunday
        return 0.35

def sessions_count_for_day(d: date) -> int:
    """How many focus sessions on a given day."""
    prob = work_probability(d)
    if random.random() > prob:
        return 0  # Day off
    # Weekdays: 2-8 sessions, weekends: 1-4
    if d.weekday() < 5:
        return random.choices([0, 1, 2, 3, 4, 5, 6, 7, 8],
                              weights=[5, 8, 15, 20, 20, 15, 10, 5, 2])[0]
    else:
        return random.choices([0, 1, 2, 3, 4],
                              weights=[20, 25, 30, 15, 10])[0]

def focus_hour_weights():
    """Weighted distribution for focus session start hours (realistic work pattern)."""
    # Peak: 9-11am, 14-16pm; some early morning and evening
    return {
        6: 1, 7: 3, 8: 8, 9: 15, 10: 18, 11: 14,
        12: 3, 13: 6, 14: 16, 15: 15, 16: 12, 17: 8,
        18: 5, 19: 4, 20: 6, 21: 5, 22: 3, 23: 1,
    }

def pick_focus_hour() -> int:
    hw = focus_hour_weights()
    hours = list(hw.keys())
    weights = list(hw.values())
    return random.choices(hours, weights=weights)[0]

def pick_duration() -> int:
    """Focus session duration in seconds. Mostly 25-min pomodoros."""
    return random.choices(
        [15*60, 20*60, 25*60, 30*60, 35*60, 40*60, 45*60, 50*60, 60*60],
        weights=[3, 5, 40, 15, 10, 8, 5, 3, 2]
    )[0] + random.randint(-120, 120)  # jitter


def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # ── 1. Insert projects ──
    project_ids = {}
    # Keep existing 收集箱 (id=1)
    project_ids["收集箱"] = 1

    for title, color, icon in PROJECTS:
        cur.execute(
            "INSERT INTO projects (title, color, icon) VALUES (?, ?, ?)",
            (title, color, icon)
        )
        project_ids[title] = cur.lastrowid

    print(f"Inserted {len(PROJECTS)} projects")

    # ── 2. Insert tasks ──
    all_tasks = []  # (id, project_name, title, created_date, status, completed_at)

    # Spread task creation over 120 days
    for project_name, titles in TASK_TITLES.items():
        pid = project_ids[project_name]
        for i, title in enumerate(titles):
            # Spread creation dates
            days_ago = random.randint(5, 118)
            created = TODAY - timedelta(days=days_ago)
            created_dt = random_time_in_range(created, 8, 20)

            # Status distribution: ~60% done, ~15% in_progress, ~20% todo, ~5% cancelled
            r = random.random()
            if r < 0.60:
                status = "done"
                # Completed 1-30 days after creation
                comp_days = random.randint(1, min(30, days_ago))
                completed_at = created + timedelta(days=comp_days)
                completed_dt = random_time_in_range(completed_at, 9, 21)
            elif r < 0.75:
                status = "in_progress"
                completed_dt = None
            elif r < 0.95:
                status = "todo"
                completed_dt = None
            else:
                status = "cancelled"
                completed_dt = None

            # Due date: sometimes set, sometimes not
            due_at = None
            if random.random() < 0.4:
                due_days = random.randint(0, 14)
                due_at = (created + timedelta(days=due_days)).isoformat()

            pomodoro_count = random.choices([1, 2, 3, 4, 5, 6, 8],
                                            weights=[15, 25, 25, 15, 10, 5, 2])[0]
            priority = random.choices([0, 1, 2, 3], weights=[30, 35, 25, 10])[0]

            cur.execute("""
                INSERT INTO tasks (title, status, priority, project_id, parent_id,
                                   due_at, completed_at, pomodoro_count, sort_order,
                                   created_at, updated_at)
                VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
            """, (
                title, status, priority, pid, due_at,
                completed_dt.isoformat() if completed_dt else None,
                pomodoro_count,
                i,
                created_dt.isoformat(),
                (completed_dt or created_dt).isoformat(),
            ))

            task_id = cur.lastrowid
            all_tasks.append({
                "id": task_id,
                "project": project_name,
                "title": title,
                "created": created,
                "status": status,
                "completed_at": completed_dt,
                "pomodoro_count": pomodoro_count,
                "project_id": pid,
            })

    # Also add some subtasks for realism
    subtask_count = 0
    done_tasks = [t for t in all_tasks if t["status"] == "done"]
    for task in random.sample(done_tasks, min(40, len(done_tasks))):
        num_subs = random.randint(2, 5)
        for j in range(num_subs):
            sub_title = f"{task['title']} - 步骤{j+1}"
            sub_created = task["created"] + timedelta(hours=random.randint(0, 48))
            sub_completed = task["completed_at"] - timedelta(hours=random.randint(0, 24)) if task["completed_at"] else None
            cur.execute("""
                INSERT INTO tasks (title, status, priority, project_id, parent_id,
                                   completed_at, pomodoro_count, sort_order,
                                   created_at, updated_at)
                VALUES (?, 'done', 0, ?, ?, ?, 1, ?, ?, ?)
            """, (
                sub_title, task["project_id"], task["id"],
                sub_completed.isoformat() if sub_completed else None,
                j,
                sub_created.isoformat(),
                (sub_completed or sub_created).isoformat(),
            ))
            subtask_count += 1

    print(f"Inserted {len(all_tasks)} tasks + {subtask_count} subtasks")

    # ── 3. Insert focus sessions ──
    session_count = 0
    task_focus_seconds = {}  # task_id -> total seconds (for completion logs)

    current = START_DATE
    while current <= TODAY:
        n_sessions = sessions_count_for_day(current)

        # Gradually increase productivity over time (learning curve)
        days_in = (current - START_DATE).days
        productivity_boost = 1.0 + (days_in / 120) * 0.3  # up to 30% more sessions
        n_sessions = int(n_sessions * productivity_boost)

        used_hours = set()
        for _ in range(n_sessions):
            hour = pick_focus_hour()
            # Avoid too many sessions in same hour
            attempts = 0
            while hour in used_hours and attempts < 5:
                hour = pick_focus_hour()
                attempts += 1
            used_hours.add(hour)

            minute = random.randint(0, 45)
            start = datetime(current.year, current.month, current.day, hour, minute, random.randint(0, 59))
            duration = pick_duration()
            end = start + timedelta(seconds=duration)

            # 85% completed, 10% stopped early, 5% interrupted
            status_r = random.random()
            if status_r < 0.85:
                sess_status = "completed"
                pomodoros = max(1, duration // 1500)
            elif status_r < 0.95:
                sess_status = "stopped"
                duration = int(duration * random.uniform(0.3, 0.8))
                end = start + timedelta(seconds=duration)
                pomodoros = max(1, duration // 1500)
            else:
                sess_status = "interrupted"
                duration = int(duration * random.uniform(0.1, 0.5))
                end = start + timedelta(seconds=duration)
                pomodoros = 0

            # Assign to a random active task (or None)
            active_tasks = [t for t in all_tasks
                           if t["created"] <= current
                           and (t["status"] != "done" or (t["completed_at"] and t["completed_at"].date() >= current))]
            task_id = None
            if active_tasks and random.random() < 0.85:
                chosen_task = random.choice(active_tasks)
                task_id = chosen_task["id"]
                task_focus_seconds[task_id] = task_focus_seconds.get(task_id, 0) + duration

            interruption_reason = None
            if sess_status == "interrupted":
                interruption_reason = random.choice([
                    "电话打断", "有人来找", "突然想起其他事", "外卖到了",
                    "会议通知", "紧急消息", None
                ])

            cur.execute("""
                INSERT INTO focus_sessions (task_id, start_time, end_time, duration_seconds,
                                            type, status, interruption_reason, pomodoro_count)
                VALUES (?, ?, ?, ?, 'focus', ?, ?, ?)
            """, (
                task_id,
                start.isoformat(),
                end.isoformat(),
                duration,
                sess_status,
                interruption_reason,
                pomodoros,
            ))
            session_count += 1

        current += timedelta(days=1)

    print(f"Inserted {session_count} focus sessions")

    # ── 4. Insert task_completion_logs (for estimation accuracy) ──
    log_count = 0
    done_with_focus = [t for t in all_tasks if t["status"] == "done" and t["id"] in task_focus_seconds]

    for task in done_with_focus:
        estimated_seconds = task["pomodoro_count"] * 25 * 60  # estimated based on pomodoro count
        actual_seconds = task_focus_seconds[task["id"]]

        # Add some noise to make it more realistic
        if actual_seconds == 0:
            continue

        deviation_pct = ((actual_seconds - estimated_seconds) / estimated_seconds) * 100 if estimated_seconds > 0 else 0

        reasons = [None, "任务比预期复杂", "遇到技术难题", "需求变更",
                   "比预期简单", "有现成方案可参考", "调试花了很多时间"]

        cur.execute("""
            INSERT INTO task_completion_logs (task_id, task_title, estimated_seconds, actual_seconds,
                                              deviation_percentage, deviation_reason, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            task["id"],
            task["title"],
            estimated_seconds,
            actual_seconds,
            round(deviation_pct, 1),
            random.choice(reasons),
            task["completed_at"].isoformat() if task["completed_at"] else None,
        ))
        log_count += 1

    print(f"Inserted {log_count} task completion logs")

    # ── 5. Insert daily_summaries ──
    summary_count = 0
    current = START_DATE
    while current <= TODAY:
        day_str = current.isoformat()

        # Query the focus sessions we just inserted for this day
        cur.execute("""
            SELECT COALESCE(SUM(duration_seconds), 0),
                   COUNT(*),
                   COALESCE(SUM(pomodoro_count), 0)
            FROM focus_sessions
            WHERE type = 'focus' AND status IN ('completed', 'stopped')
              AND date(start_time) = ?
        """, (day_str,))
        total_focus, session_ct, total_pomodoros = cur.fetchone()

        cur.execute("""
            SELECT COUNT(*) FROM tasks
            WHERE status = 'done' AND date(completed_at) = ?
        """, (day_str,))
        tasks_completed = cur.fetchone()[0]

        cur.execute("""
            SELECT COUNT(*) FROM tasks WHERE date(created_at) = ?
        """, (day_str,))
        tasks_created = cur.fetchone()[0]

        if total_focus > 0 or tasks_completed > 0 or tasks_created > 0:
            # Build hourly distribution JSON
            cur.execute("""
                SELECT CAST(strftime('%H', start_time) AS INTEGER) as h,
                       SUM(duration_seconds)
                FROM focus_sessions
                WHERE type = 'focus' AND status IN ('completed', 'stopped')
                  AND date(start_time) = ?
                GROUP BY h
            """, (day_str,))
            hourly = {str(r[0]): r[1] for r in cur.fetchall()}
            import json
            hourly_json = json.dumps(hourly) if hourly else None

            cur.execute("""
                INSERT OR REPLACE INTO daily_summaries
                    (date, total_focus_seconds, total_pomodoros, tasks_completed,
                     tasks_created, interruptions, hourly_distribution)
                VALUES (?, ?, ?, ?, ?, 0, ?)
            """, (day_str, total_focus, total_pomodoros, tasks_completed,
                  tasks_created, hourly_json))
            summary_count += 1

        current += timedelta(days=1)

    print(f"Inserted {summary_count} daily summaries")

    conn.commit()
    conn.close()
    print("\nDone! All fake data inserted successfully.")


if __name__ == "__main__":
    main()
