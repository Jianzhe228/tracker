#!/usr/bin/env bash
# bump-version.sh — 同步更新项目版本号，避免多处漏改
#
# 版本号散落在 4 个文件，本脚本一次性同步并校验：
#   - package.json                ("version": "X")
#   - src-tauri/Cargo.toml        (version = "X")
#   - src-tauri/tauri.conf.json   ("version": "X")
#   - src-tauri/Cargo.lock        (tracker 包条目的 version)
#
# 用法:
#   ./bump-version.sh <new-version>        指定新版本，如 2.3.0
#   ./bump-version.sh major|minor|patch    基于当前版本自增
#
# 选项:
#   --commit      更新后提交（chore(release): bump version to X.Y.Z）
#   --tag         创建带注释 tag vX.Y.Z（建议与 --commit 同用）
#   --push        提交/打 tag 后用 ./push.sh --tags 推送双远端
#   -n, --dry-run 只显示将改动，不写文件
#
# 示例:
#   ./bump-version.sh minor --commit --tag --push   # 2.2.0 -> 2.3.0 并发布
#   ./bump-version.sh 2.3.1 -n                       # 预览改动

set -euo pipefail
cd "$(dirname "$0")"

PKG="package.json"
CARGO="src-tauri/Cargo.toml"
TAURI="src-tauri/tauri.conf.json"
LOCK="src-tauri/Cargo.lock"

err() { echo "[错误] $*" >&2; exit 1; }

[ -f "$PKG" ] || err "找不到 $PKG，请在项目根目录运行"

# 当前版本以 package.json 为准
CUR=$(node -p "require('./package.json').version" 2>/dev/null || true)
[ -n "$CUR" ] || CUR=$(grep -m1 '"version"' "$PKG" | sed -E 's/.*"version": *"([^"]+)".*/\1/')
[ -n "$CUR" ] || err "无法读取当前版本"

ARG="${1:-}"
[ -n "$ARG" ] || err "用法: ./bump-version.sh <new-version | major|minor|patch> [--commit] [--tag] [--push] [-n]"
shift || true

semver_re='^[0-9]+\.[0-9]+\.[0-9]+$'
if [[ "$ARG" =~ ^(major|minor|patch)$ ]]; then
  IFS=. read -r MA MI PA <<<"$CUR"
  case "$ARG" in
    major) MA=$((MA+1)); MI=0; PA=0;;
    minor) MI=$((MI+1)); PA=0;;
    patch) PA=$((PA+1));;
  esac
  NEW="$MA.$MI.$PA"
elif [[ "$ARG" =~ $semver_re ]]; then
  NEW="$ARG"
else
  err "无效版本: '$ARG'（需 X.Y.Z 或 major/minor/patch）"
fi

DRY=0; DO_COMMIT=0; DO_TAG=0; DO_PUSH=0
for a in "$@"; do
  case "$a" in
    -n|--dry-run) DRY=1;;
    --commit) DO_COMMIT=1;;
    --tag) DO_TAG=1;;
    --push) DO_PUSH=1;;
    *) err "未知选项: $a";;
  esac
done

[ "$NEW" = "$CUR" ] && err "新版本与当前版本相同: $CUR"
TAG="v$NEW"

echo "==> 版本: $CUR -> $NEW"

if [ "$DO_TAG" = 1 ] && git rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  err "tag $TAG 已存在"
fi

if [ "$DRY" = 1 ]; then
  echo "[dry-run] 将把上述 4 个文件中的 $CUR 更新为 $NEW，不写入。"
  exit 0
fi

# 逐文件精确替换（仅改目标处，避免误伤依赖版本号）
sed -i "0,/\"version\": \"$CUR\"/ s//\"version\": \"$NEW\"/" "$PKG"
sed -i "0,/^version = \"$CUR\"/ s//version = \"$NEW\"/" "$CARGO"
sed -i "0,/\"version\": \"$CUR\"/ s//\"version\": \"$NEW\"/" "$TAURI"
# Cargo.lock: 定位 name = "tracker"，改其紧随的 version 行
sed -i "/^name = \"tracker\"$/{n;s/^version = \".*\"/version = \"$NEW\"/;}" "$LOCK"

# 校验四处均已更新
fail=0
grep -q "\"version\": \"$NEW\"" "$PKG"   || { echo "[校验失败] $PKG"; fail=1; }
grep -q "^version = \"$NEW\"" "$CARGO"    || { echo "[校验失败] $CARGO"; fail=1; }
grep -q "\"version\": \"$NEW\"" "$TAURI"  || { echo "[校验失败] $TAURI"; fail=1; }
awk -v w="$NEW" '/^name = "tracker"$/{getline; if($0=="version = \"" w "\"") ok=1} END{exit ok?0:1}' "$LOCK" \
  || { echo "[校验失败] $LOCK (tracker 条目)"; fail=1; }
[ "$fail" = 0 ] || err "校验未通过，可用 git checkout -- $PKG $CARGO $TAURI $LOCK 还原"

echo "==> 已更新并校验 4 个文件:"
git --no-pager diff --stat -- "$PKG" "$CARGO" "$TAURI" "$LOCK"

if [ "$DO_COMMIT" = 1 ]; then
  git add "$PKG" "$CARGO" "$TAURI" "$LOCK"
  git commit -m "chore(release): bump version to $NEW

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" >/dev/null
  echo "==> 已提交: chore(release): bump version to $NEW"
fi

if [ "$DO_TAG" = 1 ]; then
  if [ "$DO_COMMIT" = 0 ]; then
    echo "[提示] 未带 --commit，tag 将打在当前 HEAD（版本改动尚未提交）"
  fi
  git tag -a "$TAG" -m "$TAG"
  echo "==> 已创建 tag $TAG"
fi

if [ "$DO_PUSH" = 1 ]; then
  echo "==> 推送（含 tags）..."
  ./push.sh --tags
fi

echo "==> 完成。"
[ "$DO_COMMIT" = 0 ] && echo "提示: 未提交。检查无误后可 git add 上述文件并提交，或重跑加 --commit --tag。"
exit 0
