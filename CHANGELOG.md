# Changelog

## [Unreleased]

### Added
- 任务支持 `startAt` 开始日期字段，实现多日跨度任务在日期范围内持续显示
- 任务子树组件 `TaskSubtreeItem`，支持子任务拖拽排序
- AI 模块基础架构：AI store、AI 命令通道、建议引擎（suggestion service）、提示词引擎、动作执行器、请求队列
- 统计模块：专注时段统计、每小时分布、每日汇总、项目时间分布、热力图、任务完成率等图表组件（ECharts）
- 通知中心组件与通知日志 Rust 命令通道
- 专注会话（focus session）Rust 命令与前端 service 层
- 数据导入导出、学习模式、行为模式识别等 Rust 命令桩
- WebDAV 同步 Rust service 桩
- `useECharts` composable 封装图表生命周期
- `AppFeedbackLayer` 全局反馈层组件
- UI store 管理全局 UI 状态
- 数据库 schema 新增 focus_sessions、notification_logs、ai_logs 等表及对应迁移

### Changed
- 今日/明日/本周任务筛选改为日期范围匹配：`startAt <= 当天 <= dueAt` 的任务会持续出现
- TasksView 大幅重构：新增日期选择器、子任务拖拽、AI 建议集成
- DashboardView 重构为更丰富的仪表盘布局
- SettingsView 扩展支持通知、同步、AI 等设置项
- timerStore 增强：专注会话记录、分段计时
- taskStore 增强：子任务操作、排序、批量更新
- settingsStore 扩展更多配置项（通知、同步、AI）
- domain.ts 新增大量类型定义（FocusSession、统计类型、通知类型、AI 类型等）

### Removed
- 移除旧 StatisticsView（由新的统计图表组件体系替代）
