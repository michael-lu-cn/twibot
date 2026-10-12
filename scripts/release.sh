#!/usr/bin/env bash
# twibot 一键发布：质量门 → 提交(可选) → 推送 → 构建 APK → 打 tag → 建 GitHub Release 并附 APK
#
# 用法：
#   scripts/release.sh 0.2.0                                 # 发 v0.2.0（要求工作区干净）
#   scripts/release.sh 0.2.0 --commit "feat: 话题视图"        # 先把所有改动提交，再发版
#   scripts/release.sh 0.2.0 --notes docs/release-v0.2.0.md  # 自定义 Release 说明（否则用 --generate-notes）
#   scripts/release.sh 0.2.0 --draft --prerelease            # 草稿 / 预发布
#   DRY_RUN=1 scripts/release.sh 0.2.0                       # 只打印将执行的命令，不动任何东西
#
# 常用开关（环境变量）：
#   SKIP_INSTALL=1   跳过 pnpm install --frozen-lockfile
#   SKIP_TESTS=1     跳过 test / typecheck / web build（不建议）
#   SKIP_BUILD=1     跳过 APK 构建（复用已有产物）
#   SKIP_PUSH=1      只本地打 tag，不 push（用于演练）
#
# 前置条件：gh 已登录（gh auth status 通过）、Java 21 与 Android SDK 就绪（见 README「构建 Android」）。
# 注意：当前 Gradle 配置用 Android **debug 签名**（CN=Android Debug），
#       侧载可用；正式分发请在 apps/android/apps/shell/android 配 release keystore 后再发。
set -euo pipefail

VERSION="${1:-}"
shift || true
if [[ -z "$VERSION" || "$VERSION" == "-h" || "$VERSION" == "--help" ]]; then
  sed -n '2,/^set -euo pipefail/p' "${BASH_SOURCE[0]}" | sed '$d; s/^# \{0,1\}//'
  exit 0
fi
TAG="v$VERSION"

COMMIT_MSG=""
NOTES_FILE=""
GH_EXTRA=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit) COMMIT_MSG="${2:?--commit 需要提交说明}"; shift 2 ;;
    --notes) NOTES_FILE="${2:?--notes 需要文件路径}"; shift 2 ;;
    --draft|--prerelease|--latest) GH_EXTRA+=("$1"); shift ;;
    *) echo "未知参数：$1（用 --help 看用法）" >&2; exit 2 ;;
  esac
done

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
GRADLE_DIR="$REPO_ROOT/apps/android/apps/shell/android"
APK_SRC="$GRADLE_DIR/app/build/outputs/apk/release/app-release.apk"
APK_OUT="$REPO_ROOT/dist/release/twibot-face-$TAG.apk"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# DRY_RUN=1 时只打印命令
run() {
  if [[ "${DRY_RUN:-0}" == "1" ]]; then printf '   \033[2m$ %s\033[0m\n' "$*"; else "$@"; fi
}

# ---------- 0. 前置检查 ----------
say "检查前置条件"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+].+)?$ ]] || die "版本号要像 0.2.0（收到：$VERSION）"
git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null && die "tag $TAG 已存在（删掉重来：git tag -d $TAG && git push origin :refs/tags/$TAG）"
git remote get-url origin >/dev/null 2>&1 || die "没有 origin remote，先 gh repo create / git remote add"
if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "   [dry-run] 跳过 gh auth status"
else
  gh auth status >/dev/null 2>&1 || die "gh 未登录，先跑：gh auth login"
fi
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "   仓库：$REPO_ROOT"
echo "   分支：$BRANCH"
echo "   版本：$TAG"

# ---------- 1. 提交（可选） ----------
if [[ -n "$COMMIT_MSG" ]]; then
  say "提交所有改动"
  if [[ -z "$(git status --porcelain)" ]]; then
    warn "工作区本来就是干净的，跳过提交"
  else
    git status --short
    run git add -A
    run git commit -m "$COMMIT_MSG"
  fi
fi
if [[ "${DRY_RUN:-0}" != "1" ]]; then
  [[ -z "$(git status --porcelain)" ]] || die "工作区不干净：先提交，或用 --commit \"说明\" 让脚本提交"
fi

# ---------- 2. 质量门 ----------
if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then
  say "安装依赖（frozen lockfile）"
  run pnpm install --frozen-lockfile
fi
if [[ "${SKIP_TESTS:-0}" != "1" ]]; then
  say "质量门：测试 / 类型检查 / Web 构建"
  run pnpm --filter @twibot/api test
  run pnpm --filter @twibot/face-shell test
  run pnpm --filter @twibot/face-shell typecheck
  run pnpm --filter @twibot/web build
else
  warn "SKIP_TESTS=1：跳过质量门"
fi

# ---------- 3. 推送分支 ----------
if [[ "${SKIP_PUSH:-0}" != "1" ]]; then
  say "推送分支 $BRANCH"
  run git push origin "$BRANCH"
else
  warn "SKIP_PUSH=1：不推送"
fi

# ---------- 4. 构建 APK ----------
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  say "构建 Android release APK（arm64-v8a）"
  ( cd "$GRADLE_DIR" && run ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain )
else
  warn "SKIP_BUILD=1：复用现有 APK 产物"
fi
if [[ "${DRY_RUN:-0}" != "1" ]]; then
  [[ -f "$APK_SRC" ]] || die "找不到 APK：$APK_SRC"
  mkdir -p "$(dirname "$APK_OUT")"
  cp "$APK_SRC" "$APK_OUT"
  echo "   APK → $APK_OUT（$(wc -c < "$APK_OUT" | tr -d ' ') 字节）"
fi

# ---------- 5. 打 tag ----------
say "打 tag $TAG"
run git tag -a "$TAG" -m "twibot $TAG"
if [[ "${SKIP_PUSH:-0}" != "1" ]]; then
  run git push origin "$TAG"
fi

# ---------- 6. 建 Release ----------
say "创建 GitHub Release $TAG"
NOTES_ARGS=(--generate-notes)
[[ -n "$NOTES_FILE" ]] && NOTES_ARGS=(--notes-file "$NOTES_FILE")
run gh release create "$TAG" "${APK_OUT:-}" --title "twibot $TAG" "${NOTES_ARGS[@]}" "${GH_EXTRA[@]+"${GH_EXTRA[@]}"}"

say "完成"
echo "   Release: $(gh repo view --json url -q .url 2>/dev/null || echo '<repo>')/releases/tag/$TAG"
[[ "${DRY_RUN:-0}" == "1" ]] && echo "   （dry-run：上面所有命令都没有真的执行）"
