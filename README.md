# Smart Focus Tracker

基于 **Tauri 2 + Vue 3 + TypeScript** 的桌面效率应用初始化骨架。

## 当前状态

已完成：

- 前端基础工程（Vite + Vue Router + Pinia + Tailwind）
- `src-tauri` 基础工程（Tauri v2 配置 + Rust 命令入口）
- 基础页面：仪表盘、任务、~~习惯~~、设置（习惯模块暂缓）
- 前后端命令边界示例：`health_check` / `app_version`

## 本地初始化命令（你执行）

### 1) 安装 Rust 工具链

```bash
curl https://sh.rustup.rs -sSf | sh
source "$HOME/.cargo/env"
```

### 2) 安装 Linux 桌面依赖（Ubuntu/Debian）

```bash
pkexec apt update
pkexec apt install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

### 3) 安装前端依赖

```bash
npm install
```

### 4) 启动 Web 开发模式

```bash
npm run dev
```

### 5) 启动 Tauri 桌面开发模式

```bash
npm run tauri:dev
```

## 快速启动脚本

仓库根目录提供了 `start.sh`：

```bash
./start.sh        # 默认启动 web 开发模式
./start.sh tauri  # 启动 Tauri 桌面开发模式
```

脚本会在 `node_modules` 不存在时自动执行 `npm install`。

## 目录

- 前端入口：`src/main.ts`
- 路由：`src/router/index.ts`
- 状态管理：`src/stores/*.ts`
- Tauri 入口：`src-tauri/src/lib.rs`
- Tauri 配置：`src-tauri/tauri.conf.json`
