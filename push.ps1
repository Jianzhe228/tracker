# push.ps1 — 一键推送到 GitHub (origin) 和 Gitee
# 用法:
#   .\push.ps1                       # 推送当前分支（仅推送已提交内容）
#   .\push.ps1 -m "commit message"   # 先 add -A + commit，再推送
#   .\push.ps1 -b dev                # 推送指定分支
#   .\push.ps1 -m "msg" -b dev       # 组合使用
#   .\push.ps1 -Tags                 # 同时推送 tags
param(
    [Alias("m")][string]$Message = "",
    [Alias("b")][string]$Branch  = "",
    [switch]$Tags
)

if (-not $Branch) {
    $Branch = (git rev-parse --abbrev-ref HEAD).Trim()
}

Write-Host "==> 分支: $Branch"

$dirty = [bool](git status --porcelain)

if ($Message) {
    if (-not $dirty) {
        Write-Host "[INFO] 工作区干净，跳过 commit"
    } else {
        Write-Host "==> 提交本地改动..."
        git add -A
        if ($LASTEXITCODE -ne 0) { Write-Host "[FAIL] git add 失败" -ForegroundColor Red; exit 1 }
        git commit -m $Message
        if ($LASTEXITCODE -ne 0) { Write-Host "[FAIL] git commit 失败" -ForegroundColor Red; exit 1 }
    }
} elseif ($dirty) {
    Write-Host "[警告] 工作区有未提交改动（未指定 -m，仅推送已提交内容）" -ForegroundColor Yellow
}

Write-Host ""

$githubOk = $false
$giteeOk  = $false

$extra = @()
if ($Tags) { $extra += "--tags" }

Write-Host "==> [1/2] 推送到 GitHub (origin)..."
git push origin $Branch @extra
if ($LASTEXITCODE -eq 0) { $githubOk = $true }
Write-Host ""

Write-Host "==> [2/2] 推送到 Gitee..."
git push gitee $Branch @extra
if ($LASTEXITCODE -eq 0) { $giteeOk = $true }
Write-Host ""

Write-Host "===== 结果 ====="
if ($githubOk) { Write-Host "GitHub: OK"   -ForegroundColor Green } else { Write-Host "GitHub: FAIL" -ForegroundColor Red }
if ($giteeOk)  { Write-Host "Gitee:  OK"   -ForegroundColor Green } else { Write-Host "Gitee:  FAIL" -ForegroundColor Red }

if ($githubOk -and $giteeOk) { exit 0 } else { exit 1 }
