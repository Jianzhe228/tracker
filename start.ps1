<#
.SYNOPSIS
  Smart Focus Tracker — Windows launcher

.DESCRIPTION
  Usage:
    .\start.ps1 web              Vite dev server
    .\start.ps1 tauri [debug]     Tauri desktop app (default: debug)
    .\start.ps1 tauri release     Tauri desktop app (release build)
#>

param(
  [ValidateSet('web', 'tauri')]
  [string]$Mode = 'web',

  [ValidateSet('debug', 'release')]
  [string]$TauriProfile = 'debug'
)

$ErrorActionPreference = 'Stop'
$ROOT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ROOT_DIR

Write-Host "`n=== Smart Focus Tracker ===`n" -ForegroundColor Cyan

# ── Pre-flight checks ──

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "[ERROR] npm not found. Install Node.js first." -ForegroundColor Red
  exit 1
}

# Tauri CLI comes from @tauri-apps/cli (npm), no need to check cargo here

if (-not (Test-Path 'node_modules')) {
  Write-Host "[INFO] Installing dependencies..." -ForegroundColor Yellow
  npm install
}

# ── Launch ──

switch ($Mode) {
  'web' {
    Write-Host "[INFO] Starting web dev server...`n" -ForegroundColor Green
    npm run dev
  }
  'tauri' {
    if ($TauriProfile -eq 'release') {
      Write-Host "[INFO] Building Tauri desktop app (release)...`n" -ForegroundColor Green
      npm run tauri:build
    } else {
      Write-Host "[INFO] Starting Tauri desktop app (debug)...`n" -ForegroundColor Green
      npm run tauri:dev
    }
  }
}
