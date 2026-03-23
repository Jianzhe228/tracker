# Smart Focus Tracker — 移动端适配计划

## 一、现状分析

项目当前为纯桌面端应用（Linux/Windows/macOS），使用了以下桌面专属功能：

| 功能 | 位置 | 移动端影响 |
|------|------|-----------|
| 系统托盘（tray-icon） | `lib.rs:45-91` | 移动端不存在，需禁用 |
| 开机自启（autostart） | `Cargo.toml:30` | 移动端不适用，需移除 |
| 自定义标题栏 + 窗口控制 | `App.vue:427-441` | 移动端无窗口控制，需隐藏 |
| 窗口拖拽区域 | `App.vue:260,428` | 移动端无意义，需移除 |
| 关闭最小化到托盘 | `lib.rs:28-43,99-110` | 移动端不适用 |
| 侧边栏固定布局 | `App.vue:255-257` | 需改为移动端抽屉导航 |
| 任务详情分栏面板 | `TasksView.vue:54-59,1803+` | 需改为全屏模态/底部弹窗 |
| 文件对话框（导入/导出） | `SettingsView.vue:354,379` | tauri-plugin-dialog 支持移动端 |
| SQLite 数据库 | `db/mod.rs:26-48` | 已兼容移动端，无需改动 |
| 通知 | `services/notification.ts` | tauri-plugin-notification 支持移动端 |

## 二、适配策略

### 核心原则

1. **一套代码，多端运行** — 通过平台检测 + 条件渲染实现桌面/移动共用同一代码库
2. **渐进式适配** — 先确保功能可用，再优化移动端体验
3. **桌面端不退化** — 移动端适配不能影响现有桌面端功能和体验

### 平台检测方案

```typescript
// src/utils/platform.ts
import { type } from '@tauri-apps/plugin-os';

export const platform = {
  isTauri: '__TAURI_INTERNALS__' in window,
  isMobile: false, // 启动时初始化
  isDesktop: true,
};

export async function initPlatform(): Promise<void> {
  if (!platform.isTauri) return;
  const os = type(); // 'android' | 'ios' | 'linux' | 'macos' | 'windows'
  platform.isMobile = os === 'android' || os === 'ios';
  platform.isDesktop = !platform.isMobile;
}
```

## 三、分阶段实施计划

---

### 第一阶段：基础设施搭建

**目标**：让项目能在 Android/iOS 上编译运行（即使 UI 还不完美）。

#### 1.1 初始化 Tauri 移动端项目

```bash
# 初始化 Android 项目
pnpm tauri android init

# 初始化 iOS 项目（需 macOS + Xcode）
pnpm tauri ios init
```

生成 `src-tauri/gen/android/` 和 `src-tauri/gen/apple/` 目录。

#### 1.2 条件编译桌面专属功能（Rust 端）

`src-tauri/src/lib.rs` 需要用 `#[cfg(desktop)]` 门控桌面功能：

```rust
pub fn run() {
  setup_display_env();

  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_dialog::init());

  // 桌面端专属：自启、托盘、关闭拦截
  #[cfg(desktop)]
  let builder = builder
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      None,
    ))
    .on_window_event(|window, event| {
      if let WindowEvent::CloseRequested { api, .. } = event {
        if read_close_to_tray(window.app_handle()) {
          api.prevent_close();
          let _ = window.hide();
        }
      }
    });

  builder
    .setup(|app| {
      app.manage(AppState::new(app.handle().clone()));
      #[cfg(desktop)]
      setup_tray(app)?;
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![...])
    .build(tauri::generate_context!())
    .expect("failed to build tauri app")
    .run(|_app_handle, event| {
      #[cfg(desktop)]
      if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
        if code.is_none() {
          api.prevent_exit();
        }
      }
    });
}
```

#### 1.3 Cargo.toml 调整

```toml
[dependencies]
tauri = { version = "2.0.0", features = ["tray-icon", "image-png"] }
tauri-plugin-os = "2"  # 新增：平台检测

[target.'cfg(any(target_os = "macos", windows, target_os = "linux"))'.dependencies]
tauri-plugin-autostart = "2.5.1"  # 已有，仅桌面
```

注意：`tray-icon` feature 在移动端编译时会被 Tauri 自动忽略，无需额外处理。

#### 1.4 前端平台检测工具

新建 `src/utils/platform.ts`，提供全局平台检测能力，供所有组件使用。

安装依赖：
```bash
pnpm add @tauri-apps/plugin-os
cargo add tauri-plugin-os  # 在 src-tauri/ 下
```

在 `main.ts` 的 app 初始化流程中调用 `initPlatform()`。

#### 1.5 capabilities 权限配置

`src-tauri/capabilities/default.json` 需要区分桌面和移动端权限：

```json
{
  "identifier": "default",
  "platforms": ["linux", "macOS", "windows"],
  "permissions": [
    "core:default",
    "core:window:allow-minimize",
    "core:window:allow-maximize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-close",
    "core:window:allow-start-dragging",
    "core:tray:default",
    "autostart:allow-enable",
    "autostart:allow-disable",
    "autostart:allow-is-enabled",
    "notification:default",
    "dialog:default"
  ]
}
```

新建 `src-tauri/capabilities/mobile.json`：

```json
{
  "identifier": "mobile",
  "platforms": ["android", "iOS"],
  "permissions": [
    "core:default",
    "notification:default",
    "dialog:default"
  ]
}
```

---

### 第二阶段：布局适配

**目标**：让移动端 UI 可用，核心交互正常。

#### 2.1 App.vue — 主布局改造

当前桌面布局：
```
┌──────────┬────────────────────┐
│          │    自定义标题栏     │
│  侧边栏   ├────────────────────┤
│  (固定)   │     主内容区       │
│          │                    │
└──────────┴────────────────────┘
```

移动端目标布局：
```
┌────────────────────┐
│    顶部导航栏       │
├────────────────────┤
│                    │
│     主内容区        │
│                    │
├────────────────────┤
│   底部标签栏        │
└────────────────────┘
```

改造要点：
- **移动端隐藏**：自定义标题栏、窗口控制按钮（最小化/最大化/关闭）、拖拽区域
- **侧边栏 → 底部标签栏**：移动端用底部 Tab 切换页面（今天、全部、统计、设置）
- **使用 `v-if="platform.isDesktop"` / `v-if="platform.isMobile"`** 条件渲染

#### 2.2 TasksView.vue — 任务详情面板

当前桌面端：左侧列表 + 右侧详情分栏（可拖拽调整宽度）

移动端方案：
- 点击任务 → 全屏展开详情页（或底部弹出 Sheet）
- 使用 Vue Router 导航或 overlay 模态
- 隐藏拖拽排序手柄（移动端不支持 pointer drag 逻辑），改为长按拖拽或禁用
- 详情面板的可调宽度逻辑仅桌面端保留

#### 2.3 DashboardView.vue — 统计仪表盘

- 热力图 Canvas 已通过 `ResizeObserver` 自适应容器宽度，基本兼容
- 网格布局已使用 `lg:grid-cols-4` 等响应式类，小屏自动降列
- 需检查图表在窄屏下的最小可读尺寸，必要时调整 padding/font

#### 2.4 SettingsView.vue — 设置页面

- 桌面专属设置项需隐藏：「关闭时最小化到托盘」「开机自动启动」
- 文件导入/导出：`tauri-plugin-dialog` 在移动端使用系统文件选择器，API 兼容
- WebDAV 同步、AI 设置等无需改动

---

### 第三阶段：移动端体验优化

**目标**：从「能用」到「好用」。

#### 3.1 触摸交互优化

- **拖拽排序**：桌面端的 pointer 事件拖拽在移动端体验不佳，考虑：
  - 使用 `touch` 事件替代或补充 `pointer` 事件
  - 添加触觉反馈（vibration API）
  - 长按触发拖拽模式
- **滑动手势**：
  - 任务卡片左滑删除 / 右滑完成
  - 底部 Sheet 上滑展开、下滑关闭
- **点击区域**：确保所有可交互元素最小 44×44px（Apple HIG 标准）

#### 3.2 移动端专属 UI 调整

- **字体大小**：移动端基础字号从 14px 提升到 16px（防止 iOS Safari 自动缩放）
- **输入框**：添加 `font-size: 16px` 防止 iOS 输入时页面缩放
- **安全区域**：处理刘海屏、底部手势条（`env(safe-area-inset-*)`）
- **键盘弹出**：输入框聚焦时自动滚动到可视区域
- **下拉刷新**：移动端添加下拉刷新手势

#### 3.3 移动端特有功能

- **通知**：利用移动端推送通知（番茄钟结束、任务截止提醒）
- **快捷方式**：Android 长按图标快捷操作（快速添加任务）
- **Widget**：未来可考虑桌面小组件显示今日任务和专注进度

---

### 第四阶段：构建与发布

**目标**：CI/CD 支持移动端构建和分发。

#### 4.1 Android 构建

```bash
# 开发
pnpm tauri android dev

# 构建 APK/AAB
pnpm tauri android build
```

需要：
- JDK 17+
- Android SDK（API 24+ 即 Android 7.0+）
- Android NDK

#### 4.2 iOS 构建

```bash
# 开发（需 macOS + Xcode）
pnpm tauri ios dev

# 构建
pnpm tauri ios build
```

需要：
- macOS + Xcode 15+
- Apple Developer 账号（发布到 App Store）
- 最低支持 iOS 13+

#### 4.3 CI/CD 流程

- Android：GitHub Actions 可构建 APK（无需 macOS runner）
- iOS：需要 macOS runner（GitHub Actions 提供，但分钟数更贵）
- 建议：先本地构建测试，稳定后再加入 CI

---

## 四、文件改动清单

| 阶段 | 文件 | 改动说明 |
|------|------|---------|
| 一 | `src-tauri/Cargo.toml` | 添加 `tauri-plugin-os`，确认移动端依赖 |
| 一 | `src-tauri/src/lib.rs` | `#[cfg(desktop)]` 门控托盘、自启、关闭拦截 |
| 一 | `src-tauri/capabilities/default.json` | 添加 `platforms` 字段限定桌面 |
| 一 | `src-tauri/capabilities/mobile.json` | 新建移动端权限配置 |
| 一 | `src/utils/platform.ts` | 新建平台检测工具 |
| 一 | `src/main.ts` | 初始化时调用 `initPlatform()` |
| 一 | `package.json` | 添加 `@tauri-apps/plugin-os` |
| 二 | `src/App.vue` | 条件渲染标题栏/侧边栏，移动端底部 Tab |
| 二 | `src/views/TasksView.vue` | 移动端详情改为全屏模态 |
| 二 | `src/views/SettingsView.vue` | 隐藏桌面专属设置项 |
| 二 | `src/views/DashboardView.vue` | 检查窄屏图表显示 |
| 三 | 各 `*.vue` 组件 | 触摸优化、安全区域、字号调整 |
| 四 | CI 配置 | 添加 Android/iOS 构建流程 |

## 五、优先级建议

**推荐先做 Android**，原因：
1. 不需要 macOS 即可开发和构建
2. 可以直接生成 APK 侧载测试，无需开发者账号
3. 调试工具更方便（Chrome DevTools + ADB）
4. iOS 可在 Android 验证后快速复制

## 六、风险与注意事项

1. **Tauri 移动端成熟度**：Tauri 2 的移动端支持相对较新，可能遇到平台特定 bug
2. **WebView 差异**：Android WebView（基于 Chromium）和 iOS WKWebView 的 CSS/JS 兼容性差异
3. **性能**：移动端 WebView 性能不如桌面，大量 DOM 节点时需注意（如全部任务列表）
4. **SQLite 并发**：移动端 app 生命周期不同（可能随时被系统杀掉），WAL 模式需确保数据完整性
5. **应用签名**：Android 需要 keystore，iOS 需要证书和描述文件，首次配置较复杂
