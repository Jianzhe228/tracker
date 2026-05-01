#!/usr/bin/env bash
# push.sh — 一键推送到 GitHub (origin) 和 Gitee
# 用法:
#   ./push.sh                       # 推送当前分支（仅推送已提交内容）
#   ./push.sh -m "commit message"   # 先 add -A + commit，再推送
#   ./push.sh -b dev                # 推送指定分支
#   ./push.sh -m "msg" -b dev       # 组合使用
#   ./push.sh --tags                # 同时推送 tags

set -u

MSG=""
BRANCH=""
PUSH_TAGS=0

while [ $# -gt 0 ]; do
    case "$1" in
        -m|--message) MSG="$2"; shift 2 ;;
        -b|--branch)  BRANCH="$2"; shift 2 ;;
        --tags)       PUSH_TAGS=1; shift ;;
        -h|--help)    sed -n '2,9p' "$0"; exit 0 ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
done

[ -z "$BRANCH" ] && BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "==> 分支: $BRANCH"

# 可选：先提交本地改动
if [ -n "$MSG" ]; then
    if [ -z "$(git status --porcelain)" ]; then
        echo "[INFO] 工作区干净，跳过 commit"
    else
        echo "==> 提交本地改动..."
        git add -A || { echo "[FAIL] git add 失败"; exit 1; }
        git commit -m "$MSG" || { echo "[FAIL] git commit 失败"; exit 1; }
    fi
elif [ -n "$(git status --porcelain)" ]; then
    echo "[警告] 工作区有未提交改动（未指定 -m，仅推送已提交内容）"
fi

echo

GITHUB_OK=0
GITEE_OK=0

EXTRA_ARGS=""
[ "$PUSH_TAGS" -eq 1 ] && EXTRA_ARGS="--tags"

echo "==> [1/2] 推送到 GitHub (origin)..."
if git push origin "$BRANCH" $EXTRA_ARGS; then
    GITHUB_OK=1
fi
echo

echo "==> [2/2] 推送到 Gitee..."
if git push gitee "$BRANCH" $EXTRA_ARGS; then
    GITEE_OK=1
fi
echo

echo "===== 结果 ====="
[ $GITHUB_OK -eq 1 ] && echo "GitHub: OK"   || echo "GitHub: FAIL"
[ $GITEE_OK  -eq 1 ] && echo "Gitee:  OK"   || echo "Gitee:  FAIL"

[ $GITHUB_OK -eq 1 ] && [ $GITEE_OK -eq 1 ] && exit 0 || exit 1
