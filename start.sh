#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

MODE="${1:-web}"
TAURI_PROFILE="${2:-release}"

usage() {
  echo "Usage:" >&2
  echo "  ./start.sh web" >&2
  echo "  ./start.sh tauri [debug|release]" >&2
}

if [[ "$MODE" == "tauri" ]]; then
  case "$TAURI_PROFILE" in
    debug|release)
      ;;
    *)
      echo "Error: invalid Tauri profile '$TAURI_PROFILE'. Use debug or release." >&2
      usage
      exit 1
      ;;
  esac
elif [[ -n "${2:-}" ]]; then
  echo "Error: second argument is only supported for tauri mode." >&2
  usage
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed. Please install Node.js and npm first." >&2
  exit 1
fi

if [[ "$MODE" == "tauri" ]] && ! command -v cargo >/dev/null 2>&1; then
  echo "Error: cargo is not installed. Please install Rust toolchain first." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  npm install
fi

case "$MODE" in
  web)
    echo "Starting web development server..."
    npm run dev
    ;;
  tauri)
    if [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
      # Mitigate WebKitGTK flicker when maximizing/resizing windows on Wayland.
      export WEBKIT_DISABLE_DMABUF_RENDERER=1
      export WEBKIT_DISABLE_COMPOSITING_MODE=1
      export GDK_BACKEND=wayland
      export WINIT_UNIX_BACKEND=wayland

      # Optional: force software rendering to diagnose GPU/compositor artifacts.
      # Usage: TRACKER_SOFTWARE_RENDER=1 ./start.sh tauri debug
      if [[ "${TRACKER_SOFTWARE_RENDER:-0}" == "1" ]]; then
        export LIBGL_ALWAYS_SOFTWARE=1
        echo "Wayland detected, software rendering enabled for diagnostics."
      else
        echo "Wayland detected, using native Wayland backend."
      fi
    fi

    if [[ "$TAURI_PROFILE" == "release" ]]; then
      echo "Starting Tauri desktop app (release)..."
      cargo tauri dev --release
    else
      echo "Starting Tauri desktop app (debug)..."
      cargo tauri dev
    fi
    ;;
  *)
    usage
    exit 1
    ;;
esac
