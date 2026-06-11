# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 工作方式

- 多使用 subagent 并行处理独立任务，提高效率。能并行的工作不要串行执行。
- **推送代码必须使用项目脚本**：`./push.sh`（Bash）或 `.\push.ps1`（PowerShell）。脚本同时推送 GitHub (`origin`) 和 Gitee，单边失败容错。**禁止**直接 `git push origin` / `git push gitee`，除非用户明确要求只推一边。
  - 仅推已提交内容：`./push.sh`
  - 提交并推送：`./push.sh -m "commit message"`（内部 `git add -A && git commit`）
  - 指定分支 / 推 tags：`./push.sh -b <branch>` / `./push.sh --tags`（PowerShell：`-m` / `-b` / `-Tags`）

## Project Overview

Smart Focus Tracker — Tauri 2 + Vue 3 桌面端任务管理应用，集成番茄钟、专注统计和 AI 辅助任务分解。

- **Frontend**: Vue 3 + TypeScript + Pinia + Tailwind CSS + vue-echarts
- **Backend**: Rust (Tauri 2) + rusqlite，SQLite（WAL 模式，app data 目录下 `tracker.db`）
- **AI**: OpenAI-compatible API（用户自配 endpoint/key/model）
- **Tauri 插件**: notification、dialog、single-instance、autostart、updater、process
- **Testing**: Vitest + happy-dom（`globals: true`）

## 常用命令

```bash
./start.sh               # Web 开发模式（自动 npm install）
./start.sh tauri         # Tauri 桌面开发模式（debug）

npm run dev              # Web 开发模式（Vite）
npm run build            # 生产构建
npm run typecheck        # vue-tsc 类型检查
npm run tauri:dev        # Tauri 开发模式（热重载 Rust + Web）
npm run tauri:build      # Tauri 生产构建

# 测试（package.json 无 test script，直接用 npx）
npx vitest run                                          # 全部测试
npx vitest run src/services/ai/__tests__/client.test.ts # 单个测试文件
npx vitest run --grep "callChatCompletion"              # 按名称过滤

# Rust（在 src-tauri/ 下）
cargo check   # 类型检查（比 build 快）
cargo clippy  # linter
```

Linux 首次开发需安装 webkit2gtk 等依赖（见 README.md）。Wayland 下遇 GPU 问题可 `TRACKER_SOFTWARE_RENDER=1 ./start.sh tauri` 强制软件渲染。

## Architecture

### 前后端边界

前端（Vue WebView）承担 UX 和大部分领域逻辑；Rust 只提供 SQLite 持久化、OS 能力（托盘/通知/自启动）、WebDAV 同步和定时调度。所有数据访问走 Tauri commands：

```
Vue 组件 → Pinia store (src/stores/) → src/services/commands/*.ts (invoke 封装)
        → src-tauri/src/commands/*.rs → db/mod.rs (rusqlite)
```

- `src/services/commands/invoke.ts` 通过 `__TAURI_INTERNALS__ in window` 检测环境；纯浏览器模式下优雅降级（返回 null/default），所有涉及 Tauri 的模块都遵循此约定。
- 新增 Rust command 必须在 `src-tauri/src/lib.rs` 的 `.invoke_handler()` 中注册。
- Rust 错误处理用 `Result<T, String>` + `.map_err(|e| e.to_string())`；前后端交换的 struct 加 `#[serde(rename_all = "camelCase")]`。

### 建议管线（核心自学习系统，src/services/suggestion/）

用户输入任务标题后的子任务建议流程：

```
keywordExtractor (C3 算法: Intl.Segmenter 分词 + n-gram + 边界合并)
  → confidenceScorer (THRESHOLD_LOCAL=0.7 / THRESHOLD_HYBRID=0.3)
      score >= 0.7 → local 策略（只用本地数据，不调 AI）
      0.3 ~ 0.7   → hybrid（本地即时展示 + AI 后台补充）
      < 0.3       → ai 保底（传入完整上下文）
  → retrievers/ (pattern / learning / history / sibling 多路召回)
  → candidateMerger + candidateRanker (合并去重排序)
  → strategy != local 时 enqueue AI job → aiStore 审批 → actionExecutor 执行
  → 用户接受/拒绝 → suggestion_feedback 回流学习引擎
```

`suggestionHarness.ts` 是管线编排入口（取代了旧的短路式 pipeline）。AI 调度在 `src/services/ai/`（queue 串行队列、client、promptEngine、actionExecutor、subtaskDedup）。

### Core Design Principles

1. **本地优先，AI 保底**：模式库、学习历史、手动子任务历史始终优先于 AI；AI 仅在本地置信度不足时 fallback。
2. **从行为学习，不靠配置**：手动创建子任务权重最高 (+2)、接受建议 (+1)、拒绝 (-1)；不要求用户配置规则模板。
3. **不做领域假设**：关键词提取用通用 n-gram，不依赖硬编码词典；AI prompt 不假设任务类型。
4. **丰富上下文 > 巧妙 prompt**：调 AI 时带上用户历史模式、已接受/已拒绝建议、手动子任务历史、项目内其他任务。
5. **不写兼容代码**：项目初期，直接重构，不写兼容层。

### Database

SQLite schema 在 `src-tauri/src/db/mod.rs`，以 `PRAGMA user_version` 管理（当前 **v1**，本版本视为全新设计的第一版）。**没有增量迁移阶梯**：全新数据库由单一基线 schema 在一个事务内一次建成；任何更早构建产生的数据库文件启动时直接报错拒绝，不做兼容。新增 schema 变更时：把变更合并进基线 + 写一个"上一版本→新版本"的迁移分支 + 版本号 +1，不保留更老的升级路径。表设计的权威文档是 `docs/数据库设计说明.md`。

表分 5 域：核心任务域（projects/tasks/recurring_rules）、专注与统计域（focus_sessions/focus_session_segments/task_completion_logs）、AI 与学习域（ai_skills/ai_jobs/subtask_patterns/subtask_learn_log/keyword_clusters）、建议与预测域（suggestion_feedback/suggestion_runs/suggestion_candidates/task_creation_history/pending_predictions）、系统辅助域（user_settings/notification_logs/task_deletion_logs）。

任务为软删除（`deleted_at`，10 秒撤销窗口）；子任务用 `parent_id`；重复任务关联 `recurring_rule_id`。

### 前端关键设计

- **TimerView 模态化**：番茄钟不是独立路由，通过 `useFocusModal` composable 以模态框呈现。
- **TasksView 复用**：today/all/project 等 filter 通过 router props 切换同一组件。
- **通知双写**：OS 原生通知 + `notification_logs` 落库（供通知中心展示）。
- **Stores**：`taskStore`（任务 CRUD/撤销/项目）、`timerStore`（番茄钟状态机，分段 tracking 自动落库）、`aiStore` + `aiPendingJobs`（AI 任务审批）、`predictionStore`（定时预测，监听后端事件）、`settingsStore`、`statisticsStore`、`uiStore`。
- **Import 顺序**：Vue 核心 → 外部库（字母序）→ 内部服务/commands → 工具函数。

### App 初始化与系统托盘

1. Rust：`lib.rs` → `AppState::new()` → `init_db()` → `run_migrations()`；启动 `prediction_scheduler` 后台线程（每小时检查，emit 事件到前端）。
2. 前端：`src/main.ts` mount 时调 `appInit()`（拉取 settings/projects/recurring_rules），`app_init` 内生成今日重复任务实例。
3. 窗口无边框（自定义标题栏）；关闭默认最小化到托盘（`closeToTray` 设置）；single-instance 单实例运行。

## 参考文档

- `docs/数据库设计说明.md` — 当前数据库设计（权威）
- `docs/ARCHITECTURE.md` / `docs/DESIGN.md` / `docs/REQUIREMENTS.md` — 架构/设计/需求规划稿
- `docs/优化项/` — 历次架构优化与评审清单
