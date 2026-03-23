# 最小化到系统托盘 - 设计文档

## 概述

为 Smart Focus Tracker 添加系统托盘支持，用户关闭窗口时可选择最小化到托盘而非退出程序。行为可在设置中配置。

## 需求

1. 关闭窗口时默认最小化到系统托盘（隐藏窗口）
2. 用户可在设置中切换：最小化到托盘 / 直接退出
3. 系统托盘图标右键菜单：「显示窗口」「退出程序」
4. 左键单击托盘图标：显示并聚焦窗口

## 架构

### Rust 端（`src-tauri/src/lib.rs`）

**系统托盘初始化**：在 `tauri::Builder` 链中使用 `TrayIconBuilder` 创建托盘图标，绑定菜单和事件。

**关闭事件拦截**：通过 `on_window_event` 监听 `CloseRequested` 事件，从数据库读取 `close_to_tray` 设置值，决定隐藏窗口还是正常退出。

```rust
// 伪代码
.on_window_event(|window, event| {
    if let WindowEvent::CloseRequested { api, .. } = event {
        let close_to_tray = read_setting("close_to_tray"); // 从 DB 读取
        if close_to_tray {
            api.prevent_close();
            window.hide().unwrap();
        }
    }
})
```

**托盘菜单**：
- 「显示窗口」→ `window.show()` + `window.set_focus()`
- 「退出程序」→ `app.exit(0)`

**左键点击**：`window.show()` + `window.set_focus()`

### 数据库

复用现有 `user_settings` 表（key-value 存储），新增一行：

| key | value |
|-----|-------|
| `close_to_tray` | `"true"` (默认) |

无需 schema 迁移，`user_settings` 已支持任意 key-value。

### 前端 Store（`src/stores/settingsStore.ts`）

新增 `closeToTray` 状态字段，遵循现有 settings 模式：
- `loadFromData()` 中从初始化数据加载
- computed setter 调用 `setSetting()` Tauri command 持久化

### 前端 UI（`src/views/SettingsView.vue`）

在设置页面添加「通用」或「窗口」区域，包含一个开关：

> **关闭时最小化到托盘**
> 开启后，点击关闭按钮将最小化到系统托盘而非退出程序。

使用与现有设置项一致的 toggle 组件样式。

### 托盘图标

复用应用图标 `src-tauri/icons/icon.png`（或对应平台格式）。

## 数据流

```
用户点击关闭（标题栏 X / Alt+F4 / 任务栏关闭）
  → Rust on_window_event 捕获 CloseRequested
  → 读取 DB user_settings.close_to_tray
  → "true": api.prevent_close() + window.hide()
  → "false": 正常退出

托盘图标左键单击：
  → window.show() + window.set_focus()

托盘右键菜单「显示窗口」：
  → window.show() + window.set_focus()

托盘右键菜单「退出程序」：
  → app.exit(0)

设置页面切换 toggle：
  → settingsStore.closeToTray = value
  → Tauri command setSetting("close_to_tray", value)
  → DB 持久化
```

## 影响范围

| 文件 | 变更 |
|------|------|
| `src-tauri/Cargo.toml` | 无需新增依赖（Tauri 2 内置 tray 支持） |
| `src-tauri/src/lib.rs` | 添加托盘初始化 + 关闭事件拦截 |
| `src-tauri/tauri.conf.json` | 添加 tray 权限配置 |
| `src/stores/settingsStore.ts` | 新增 `closeToTray` 字段 |
| `src/views/SettingsView.vue` | 新增关闭行为设置 UI |

## 边界情况

- **应用启动时**：托盘图标始终显示，不依赖关闭行为设置
- **设置未初始化**：默认 `close_to_tray = true`（最小化到托盘）
- **窗口已隐藏时再次关闭**：不会触发（窗口不可见时无法关闭）
- **Linux 托盘兼容性**：依赖桌面环境对 XDG StatusNotifierItem 的支持，大多数现代 DE 均支持
