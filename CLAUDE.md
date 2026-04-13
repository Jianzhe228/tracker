# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 工作方式

- 多使用 subagent 并行处理独立任务，提高效率。能并行的工作不要串行执行。

## Project Overview

Smart Focus Tracker — Tauri 2 + Vue 3 桌面端任务管理应用，集成番茄钟、专注统计和 AI 辅助任务分解。

## Tech Stack

- **Frontend**: Vue 3 + TypeScript + Pinia + Tailwind CSS + vue-echarts
- **Backend**: Rust (Tauri 2) + rusqlite
- **Database**: SQLite (WAL mode, tracker.db in app data directory)
- **AI**: OpenAI-compatible API (用户自配 endpoint/key/model)
- **Charts**: ECharts (via vue-echarts)
- **Tauri Plugins**: notification, dialog, single-instance, autostart
- **Testing**: Vitest + happy-dom

## Codebase Retrieval Rules

### 必须调用 codebase-retrieval 的时机

1. **任何任务开始前** — 先检索相关模块，建立全局认知，再开始写代码
2. **遇到不确定的依赖** — 调用某个函数/类前，先检索它的实现和用法
3. **写新代码前** — 检索是否已有类似实现，避免重复造轮子
4. **出现 bug 时** — 先检索所有可能影响该行为的相关代码路径
5. **修改接口/类型时** — 检索所有调用方，评估影响范围
6. **写测试前** — 检索现有测试的模式和 mock 方式，保持风格一致
7. **Code Review 时** — 检索被修改代码的历史上下文和相关约定

### 调用方式

- 每次提问要**语义化**，描述意图而非关键词
  - ❌ 搜索 "UserService login"
  - ✅ 搜索 "用户认证失败后的错误处理和重试逻辑"
- 一个任务允许**多轮检索**，先宏观后微观
- 检索结果要结合 read 工具读取完整文件，不能只看片段

### 分层检索策略

```
第一轮：检索"整体架构和模块划分"
    ↓
第二轮：检索"目标功能所在的子系统边界"
    ↓
第三轮：检索"具体实现的细节和边缘情况"
    ↓
第四轮：检索"相关测试和已知的历史问题"
```

### 完整任务流

```
收到任务
  → [Context Engine] 检索整体架构
  → [Context Engine] 检索具体相关模块
  → [read] 精读定位到的关键文件
  → [Context Engine] 检索是否有现有类似实现
  → 开始编写
  → [Context Engine] 检索所有调用方 / 影响范围
  → [Context Engine] 检索现有测试模式
  → 编写测试
  → 完成
```

### 代码搜索（MCP 工具）

主检索工具为 `augment-context-engine MCP`（项目根目录 `augment-context-engine.md` 配置）。当 augment-context-engine 无法满足需求时，使用 `mcp__fast-context__fast_context_search` 作为补充：

- 用自然语言描述要找的逻辑（如"部署流程"、"事件处理"）
- 跨模块、跨层级的调用链路追踪
- 中文语义搜索（支持中英文双语查询）

## 常用命令

```bash
# 快速启动（自动安装依赖）
./start.sh              # Web 开发模式
./start.sh tauri        # Tauri 桌面开发模式（debug）
./start.sh tauri release # Tauri 桌面开发模式（release）

# 前端
npm run dev              # Web 开发模式（Vite）
npm run build            # 生产构建
npm run typecheck        # TypeScript 类型检查

# Tauri 桌面应用
npm run tauri:dev        # Tauri 开发模式（热重载 Rust + Web）
npm run tauri:build      # Tauri 生产构建

# 测试
npx vitest run                          # 运行所有测试
npx vitest run src/services/ai/client.test.ts  # 运行单个测试文件

# Rust
cargo check   # 类型检查（比 build 快）
cargo clippy  # linter
```

### Linux 开发依赖

首次在 Linux 上开发前需安装桌面依赖：

```bash
pkexec apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

Wayland 环境下运行 Tauri：脚本已自动设置相关环境变量。如遇 GPU/合成器问题，可用 `TRACKER_SOFTWARE_RENDER=1 ./start.sh tauri` 强制软件渲染诊断。

### 测试进阶用法

```bash
npx vitest run --grep "callChatCompletion"   # 按名称过滤测试
npx vitest run --coverage                      # 生成覆盖率报告
```

## Core Design Principles

### 1. 本地优先，AI 保底
本地数据（模式库、学习历史、手动子任务历史）始终优先于 AI 建议。AI 仅在本地数据置信度不足时作为 fallback。置信度通过 `confidenceScorer.ts` 计算。

### 2. 从行为学习，不靠配置
系统通过观察用户行为自动学习：手动创建子任务（权重最高 +2）、接受 AI 建议 (+1)、拒绝建议 (-1)。不要求用户手动配置规则或模板。

### 3. 不做领域假设
AI prompt、关键词提取、建议逻辑不假设特定任务类型。关键词提取使用通用 n-gram 方式，不依赖硬编码词典。AI prompt 让模型根据任务标题和上下文推断任务类型。

### 4. 置信度门控 AI 调用
- score >= 0.7 → 仅用本地数据（不调 AI）
- 0.3-0.7 → 混合（本地即时展示 + AI 后台补充）
- < 0.3 → AI 保底（传入完整上下文）

### 5. 丰富上下文 > 巧妙 prompt
调 AI 时提供最大上下文：用户历史模式、已接受建议、已拒绝建议（告知 AI 避免）、手动子任务历史、项目内其他任务。

### 6. 数据持久化
所有学习数据经 SQLite 持久化。关键表：`subtask_learn_log`、`suggestion_feedback`、`task_subtask_history`、`subtask_patterns`、`keyword_clusters`。

### 7. 不写兼容代码
项目初期，需要修改时直接重构，不写兼容层或迁移兼容代码。

## Architecture Conventions

### Frontend (Vue/TypeScript)

#### 目录结构

```
src/
├── views/                    # 页面级组件（PascalCase）
│   ├── DashboardView.vue     # 首页仪表盘（默认路由，非懒加载）
│   ├── TasksView.vue        # 任务列表（today/all/project filter，懒加载）
│   ├── SettingsView.vue      # 设置页（懒加载）
│   └── TimerView.vue         # 番茄钟页面
├── components/               # 可复用 UI 组件
│   ├── charts/              # ECharts 图表组件
│   ├── FocusModal.vue       # 番茄钟模态框（模态化）
│   ├── AppFeedbackLayer.vue # 全局反馈层
│   ├── ProjectContextMenu.vue
│   ├── ProjectFormPopover.vue
│   ├── NotificationCenter.vue
│   └── ReportModal.vue      # 统计报告弹窗
├── stores/                   # Pinia 状态管理（camelCase + Store suffix）
│   ├── taskStore.ts         # 任务 CRUD 和列表状态
│   ├── timerStore.ts        # 番茄钟状态机
│   ├── aiStore.ts           # AI 任务队列和结果审批
│   ├── predictionStore.ts   # 定时任务预测
│   ├── settingsStore.ts     # 用户设置
│   ├── statisticsStore.ts   # 统计数据和图表数据
│   └── uiStore.ts           # UI 状态（侧边栏、模态框等）
├── services/
│   ├── commands/            # Tauri invoke() 封装（调用 Rust 命令）
│   │   ├── invoke.ts        # invoke 基础封装（自动检测 Tauri 环境）
│   │   ├── init.ts          # app_init / task_list_init
│   │   ├── task.ts          # 任务 CRUD
│   │   ├── project.ts       # 项目 CRUD
│   │   ├── recurring.ts     # 重复规则
│   │   ├── settings.ts      # 设置读写
│   │   ├── notification.ts  # 通知日志
│   │   ├── focusSession.ts # 专注会话
│   │   ├── statistics.ts    # 统计数据查询
│   │   ├── ai.ts           # AI skills/jobs 管理
│   │   ├── pattern.ts       # 模式模板 CRUD + 匹配
│   │   ├── learning.ts      # 学习引擎查询
│   │   ├── prediction.ts    # 预测任务
│   │   ├── sync.ts         # WebDAV 同步
│   │   └── data.ts         # 数据导入导出
│   ├── ai/                  # AI 调度（queue、prompt、client、actionExecutor、types）
│   │   ├── types.ts         # AiSkill / AiJob / AiAction 类型
│   │   ├── queue.ts         # 异步串行 AI 任务队列（enqueue）
│   │   ├── client.ts        # OpenAI-compatible API 调用
│   │   ├── promptEngine.ts  # 模板变量渲染
│   │   ├── actionExecutor.ts # AI 返回动作的执行
│   │   └── taskAssistant.ts # 日期推断 / 番茄数估算
│   ├── suggestion/           # 建议管线（核心自学习系统）
│   │   ├── suggestionPipeline.ts  # 管线编排（keyword → confidence → pattern/learning/AI）
│   │   ├── keywordExtractor.ts    # 关键词提取（Algorithm C3：Intl.Segmenter + n-gram）
│   │   ├── confidenceScorer.ts     # 置信度计算（决定 local/hybrid/ai 策略）
│   │   ├── patternMatcher.ts       # 模式模板匹配
│   │   ├── learningEngine.ts       # 学习引擎（从行为历史建议子任务）
│   │   └── keywordCache.ts         # 已知关键词缓存（加速匹配）
│   └── notification.ts      # 通知封装（OS 通知 + 写日志）
├── composables/             # Vue composables
│   ├── useFocusModal.ts     # 番茄钟模态框状态管理
│   └── useSuggestionPanel.ts # 建议面板状态管理
├── types/
│   └── domain.ts            # 核心领域类型（TaskItem、ProjectItem、统计类型等）
├── utils/
│   ├── date.ts              # 日期工具（toDateKey、formatMinutes 等）
│   ├── validation.ts        # 表单验证
│   ├── constants.ts         # 常量（APP_NAME 等）
│   └── __tests__/          # 工具函数测试
├── router/
│   └── index.ts             # Vue Router 配置
├── assets/                  # 静态资源和样式
├── main.ts                  # Vue 入口
└── App.vue                  # 根组件
```

#### 前端关键设计

- **Tauri 环境检测**：所有涉及 Tauri 的模块通过 `__TAURI_INTERNALS__ in window` 检测，非 Tauri 环境优雅降级（返回 null/default）
- **TimerView 模态化**：番茄钟不作为独立路由，通过 `useFocusModal` composable 模态化
- **TasksView 复用**：today/all/project 等 filter 通过 router props 切换，使用同一组件
- **通知双写**：OS 原生通知 + `notification_logs` 表落库（供通知中心展示）
- **Import 顺序**：Vue 核心 → 外部库（按字母序）→ 内部服务/commands → 工具函数

### Backend (Rust)

#### 目录结构

```
src-tauri/src/
├── commands/               # Tauri commands（15 个模块）
│   ├── mod.rs             # 模块汇总
│   ├── health.rs          # health_check / app_version / is_debug_build
│   ├── init.rs            # app_init（启动初始化）/ task_list_init（分页加载）
│   ├── task.rs            # 任务 CRUD（软删除，10 秒撤销窗口）
│   ├── project.rs         # 项目 CRUD
│   ├── recurring.rs        # 重复规则 CRUD
│   ├── settings.rs         # 设置读写（user_settings 表）
│   ├── notification.rs     # 通知日志 CRUD
│   ├── focus_session.rs    # 专注会话 CRUD + 统计 + 项目分布
│   ├── statistics.rs       # 统计数据查询（overview/heatmap/日时分布/完成率等）
│   ├── ai.rs              # AI skills/jobs CRUD
│   ├── pattern.rs          # 模式模板 CRUD + 匹配
│   ├── learning.rs         # 学习引擎（learn_record/suggest/stats/feedback/cluster）
│   ├── prediction.rs       # 预测任务（历史记录/分析上下文/pending/清理）
│   ├── sync.rs            # WebDAV 测试/上传/下载/状态
│   └── data.rs            # 数据导入/导出/清空
├── db/
│   └── mod.rs             # SQLite 管理（rusqlite，WAL 模式）+ migrations
├── services/
│   ├── mod.rs
│   ├── recurring.rs        # 重复任务实例生成（启动时调用）
│   ├── webdav.rs          # WebDAV 客户端（reqwest）
│   └── prediction_scheduler.rs # 定时预测调度（每小时检查，emit 事件到前端）
├── lib.rs                  # App setup、commands 注册、托盘、系统托盘
└── main.rs                 # Rust 入口
```

#### Rust 代码规范

- **错误处理**：使用 `Result<T, String>` 处理可失败操作，`.map_err(|e| e.to_string())` 转换
- **序列化**：前后端交换的 struct 使用 `#[serde(rename_all = "camelCase")]`
- **命令注册**：新命令需在 `lib.rs` 的 `.invoke_handler()` 中注册

### Database Schema (SQLite, schema version: v17)

#### 核心表

| 表名 | 用途 |
|------|------|
| `user_settings` | 用户设置（key-value） |
| `projects` | 项目清单（支持层级 parent_id） |
| `tags` | 标签 |
| `tasks` | 任务（软删除 deleted_at，子任务 parent_id，重复任务 recurring_rule_id，多日 start_at，重新调度 rescheduled_to） |
| `task_tags` | 任务-标签关联 |
| `focus_sessions` | 专注会话记录 |
| `focus_session_segments` | 专注时段分段（任务切换时切分） |
| `recurring_rules` | 重复规则模板 |
| `notification_logs` | 通知历史 |
| `daily_summaries` | 每日汇总（定时聚合） |
| `task_completion_logs` | 任务完成日志（含预估 vs 实际对比） |
| `task_deletion_logs` | 任务删除日志 |

#### AI 学习表

| 表名 | 用途 |
|------|------|
| `subtask_patterns` | 模式模板库（用户定义 + 内置） |
| `subtask_learn_log` | 关键词→子任务学习日志（权重分数） |
| `suggestion_feedback` | 建议接受/拒绝记录 |
| `task_subtask_history` | 任务完成时子任务快照 |
| `keyword_clusters` | 关键词语义聚类 |
| `ai_skills` | AI 技能定义（prompt 模板存表中） |
| `ai_jobs` | AI 任务队列 |
| `ai_logs` | AI 建议日志（trigger_type/context/suggestion/user_action） |
| `task_creation_history` | 任务创建历史（用于 AI 预测） |
| `pending_predictions` | 定时 AI 预测生成的任务建议 |

### AI Integration Architecture

#### 建议管线（Suggestion Pipeline）

```
用户输入任务标题
      │
      ▼
keywordExtractor.ts (C3 算法)
提取关键词
      │
      ▼
confidenceScorer.ts
计算置信度
      │
      ├─ score >= 0.7 → local 策略（只用本地数据）
      ├─ 0.3-0.7 → hybrid 策略（本地 + 后台 AI）
      └─ < 0.3 → ai 策略（仅 AI，完整上下文）
      │
      ▼
patternMatcher.ts (Layer 1) → 模式模板匹配
      │
      ▼ (无匹配)
learningEngine.ts (Layer 2) → 用户行为学习
      │
      ▼ (有结果 → 返回用户)
      │
      ▼ (strategy != local → 后台调用 AI)
enqueue('task_decompose', context)
      │
      ▼
aiStore.ts
approve/reject → actionExecutor
      │
      ▼
feedbackRecord → 学习引擎回流
```

#### AI 内置技能

- `task_decompose`：任务拆解（on_task_create 触发）
- `task_history_analyzer`：任务历史分析（scheduled 触发，用于预测）

#### 关键词提取算法（C3）

1. Intl.Segmenter 中文分词
2. 过滤时间词噪声（防止跨任务污染）
3. 单字 run 在功能词处切分，生成 bigram + trigram
4. 相邻多字词 join（高等+数学 → 高等数学）
5. 边界合并（菜+市场 → 菜市场）
6. 已知关键词优先

### 系统托盘与单实例

- 窗口无边框（`decorations: false`），自定义标题栏
- 关闭窗口默认最小化到系统托盘（`closeToTray` 设置控制）
- 左键点击托盘图标显示窗口，单实例运行（`single_instance` 插件）
- Tauri 插件：notification、dialog、single_instance、autostart

### App 初始化流程

1. `src-tauri/src/lib.rs` → `AppState::new()` → `init_db()` → `run_migrations()`
2. 前端 `src/main.ts` mount 时调用 `appInit()`（获取 settings/projects/recurring_rules）
3. `app_init` 中调用 `generate_recurring_tasks()` 生成今日重复任务实例
4. 启动 `prediction_scheduler` 后台线程（每小时检查）

### 前端 Stores 职责

| Store | 职责 |
|-------|------|
| `taskStore` | 任务 CRUD、列表、撤销删除、项目管理 |
| `timerStore` | 番茄钟状态机（focus/break 模式，倒计时/正计时，暂停/恢复，分段 tracking，自动保存到 SQLite） |
| `aiStore` | AI skills/jobs 管理，任务提交、审批、反馈 |
| `predictionStore` | 定时预测任务管理（监听后端事件，通知提醒） |
| `settingsStore` | timer/notification/webdav/ai 设置，localStorage 持久化 |
| `statisticsStore` | 统计数据获取（overview/focus/heatmap/日时分布/项目分布/完成率/周统计），按 dateRange 筛选 |
| `uiStore` | 侧边栏、模态框、全局通知、确认对话框 |

### 统计图表（ECharts）

- 专注时段热力图（年度，小时+天）
- 每小时专注分布（柱状图）
- 项目时间分布（饼图/环形图）
- 任务完成率（已完成/进行中/已取消/已逾期）
- 番茄钟时间线（tooltip 显示 X小时Y分钟）
- 预估 vs 实际对比
- 周专注趋势 / 周任务速率
