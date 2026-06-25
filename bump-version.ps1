<#
.SYNOPSIS
  同步更新项目版本号，避免多处漏改（bump-version.sh 的 PowerShell 版）。

.DESCRIPTION
  版本号散落在 4 个文件，本脚本一次性同步并校验：
    - package.json                ("version": "X")
    - src-tauri/Cargo.toml        (version = "X")
    - src-tauri/tauri.conf.json   ("version": "X")
    - src-tauri/Cargo.lock        (tracker 包条目的 version)

.PARAMETER Version
  新版本：X.Y.Z，或 major / minor / patch（基于当前版本自增）。

.EXAMPLE
  .\bump-version.ps1 minor -Commit -Tag -Push   # 2.2.0 -> 2.3.0 并发布
  .\bump-version.ps1 2.3.1 -DryRun              # 预览改动
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Version,
  [switch]$Commit,
  [switch]$Tag,
  [switch]$Push,
  [Alias('n')][switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Die($msg) { Write-Error "[错误] $msg"; exit 1 }

$pkg   = 'package.json'
$cargo = 'src-tauri/Cargo.toml'
$tauri = 'src-tauri/tauri.conf.json'
$lock  = 'src-tauri/Cargo.lock'

if (-not (Test-Path $pkg)) { Die "找不到 $pkg，请在项目根目录运行" }

# 当前版本以 package.json 为准
$cur = (Get-Content $pkg -Raw | ConvertFrom-Json).version
if (-not $cur) { Die "无法读取当前版本" }

# 解析新版本
if ($Version -match '^(major|minor|patch)$') {
  $p = $cur.Split('.')
  [int]$ma = $p[0]; [int]$mi = $p[1]; [int]$pa = $p[2]
  switch ($Version) {
    'major' { $ma++; $mi = 0; $pa = 0 }
    'minor' { $mi++; $pa = 0 }
    'patch' { $pa++ }
  }
  $new = "$ma.$mi.$pa"
} elseif ($Version -match '^\d+\.\d+\.\d+$') {
  $new = $Version
} else {
  Die "无效版本: '$Version'（需 X.Y.Z 或 major/minor/patch）"
}

if ($new -eq $cur) { Die "新版本与当前版本相同: $cur" }
$tagName = "v$new"
Write-Host "==> 版本: $cur -> $new"

if ($Tag -and (git rev-parse -q --verify "refs/tags/$tagName" 2>$null)) {
  Die "tag $tagName 已存在"
}

if ($DryRun) {
  Write-Host "[dry-run] 将把 4 个文件中的 $cur 更新为 $new，不写入。"
  exit 0
}

$curEsc = [regex]::Escape($cur)

function Replace-First($file, $pattern, $replacement) {
  $text = Get-Content $file -Raw
  $rx = [regex]$pattern
  $text = $rx.Replace($text, $replacement, 1)
  # 保留原文件换行风格，写回时不加 BOM
  [System.IO.File]::WriteAllText((Resolve-Path $file), $text)
}

Replace-First $pkg   "`"version`":\s*`"$curEsc`"" "`"version`": `"$new`""
Replace-First $cargo "(?m)^version\s*=\s*`"$curEsc`"" "version = `"$new`""
Replace-First $tauri "`"version`":\s*`"$curEsc`"" "`"version`": `"$new`""
# Cargo.lock: 仅替换 name = "tracker" 紧随的 version
Replace-First $lock  "(?m)^name = `"tracker`"\r?\nversion = `"$curEsc`"" "name = `"tracker`"`nversion = `"$new`""

# 校验
$fail = $false
if ((Get-Content $pkg   -Raw) -notmatch "`"version`":\s*`"$([regex]::Escape($new))`"") { Write-Host "[校验失败] $pkg"; $fail = $true }
if ((Get-Content $cargo -Raw) -notmatch "(?m)^version\s*=\s*`"$([regex]::Escape($new))`"") { Write-Host "[校验失败] $cargo"; $fail = $true }
if ((Get-Content $tauri -Raw) -notmatch "`"version`":\s*`"$([regex]::Escape($new))`"") { Write-Host "[校验失败] $tauri"; $fail = $true }
if ((Get-Content $lock  -Raw) -notmatch "(?m)^name = `"tracker`"\r?\nversion = `"$([regex]::Escape($new))`"") { Write-Host "[校验失败] $lock (tracker 条目)"; $fail = $true }
if ($fail) { Die "校验未通过，可用 git checkout -- $pkg $cargo $tauri $lock 还原" }

Write-Host "==> 已更新并校验 4 个文件:"
git --no-pager diff --stat -- $pkg $cargo $tauri $lock

if ($Commit) {
  git add $pkg $cargo $tauri $lock
  git commit -m "chore(release): bump version to $new`n`nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>" | Out-Null
  Write-Host "==> 已提交: chore(release): bump version to $new"
}

if ($Tag) {
  if (-not $Commit) { Write-Host "[提示] 未带 -Commit，tag 将打在当前 HEAD（版本改动尚未提交）" }
  git tag -a $tagName -m $tagName
  Write-Host "==> 已创建 tag $tagName"
}

if ($Push) {
  Write-Host "==> 推送（含 tags）..."
  & ".\push.ps1" -Tags
}

Write-Host "==> 完成。"
if (-not $Commit) { Write-Host "提示: 未提交。检查无误后可提交，或重跑加 -Commit -Tag。" }
