#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

MODE="${1:-web}"

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
    echo "Starting Tauri desktop app (release)..."
    cargo tauri dev --release
    ;;
  *)
    echo "Usage: ./start.sh [web|tauri]" >&2
    exit 1
    ;;
esac
