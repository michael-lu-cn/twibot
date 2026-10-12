#!/usr/bin/env bash
# 远端插件 chunk 构建管线:正常 TSX(可 import/可 JSX)→ IIFE 裸脚本 + __face_plugins 注册行。
#
# 用法: bash apps/android/scripts/build-chunk.sh <name>
#   源:   apps/android/apps/shell/chunks/<name>.src.tsx
#         或 apps/android/apps/remote-chunk-demo/src/<name>.src.tsx(旧示例)
#   产物: apps/android/apps/remote-chunk-demo/dist/<name>.client.js
# 打印 rev(sha1-12) —— 即清单/roster remote 行所需的修订号。
#
# 依赖面:只 external react / react-native / @react-native-async-storage/async-storage
# (壳的 `new Function('globalThis','require',...)` 注入面),其余全部静态打进 chunk。
# 服务端:apps/api 的 chunk-server 插件现扫 dist/ 出清单,所以重建后**不用重启 API**。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ANDROID_DIR="$(cd "$HERE/.." && pwd)"      # apps/android
REPO_ROOT="$(cd "$ANDROID_DIR/../.." && pwd)" # 仓库根
DEMO="$ANDROID_DIR/apps/remote-chunk-demo"
NAME="${1:?usage: build-chunk.sh <name>}"

SRC="$ANDROID_DIR/apps/shell/chunks/$NAME.src.tsx"
[ -f "$SRC" ] || SRC="$DEMO/src/$NAME.src.tsx"
[ -f "$SRC" ] || {
  echo "no source: 既没有 $ANDROID_DIR/apps/shell/chunks/$NAME.src.tsx" >&2
  echo "           也没有 $DEMO/src/$NAME.src.tsx" >&2
  exit 1
}

OUT_DIR="${OUT_DIR:-$DEMO/dist}"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/$NAME.client.js"
GLOBAL="__face_chunk_$(echo "$NAME" | tr '-' '_')"

# esbuild 定位:显式 ESBUILD > PATH > pnpm store(仓库里没有顶层 .bin/esbuild)。
ESBUILD="${ESBUILD:-}"
if [ -z "$ESBUILD" ]; then
  ESBUILD="$(command -v esbuild || true)"
fi
if [ -z "$ESBUILD" ]; then
  ESBUILD="$(ls "$REPO_ROOT"/node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild 2>/dev/null | head -1 || true)"
fi
[ -x "$ESBUILD" ] || { echo "esbuild 不可用:设 ESBUILD=/path/to/esbuild(先 pnpm install)" >&2; exit 1; }

"$ESBUILD" "$SRC" \
  --bundle \
  --format=iife \
  --global-name="$GLOBAL" \
  --platform=browser \
  --jsx=transform \
  --target=es2020 \
  --legal-comments=none \
  --define:process.env.NODE_ENV='"production"' \
  --define:__DEV__=false \
  --external:react \
  --external:react-native \
  --external:@react-native-async-storage/async-storage \
  "--footer:js=globalThis.__face_plugins = globalThis.__face_plugins || {};globalThis.__face_plugins['$NAME'] = { mount: (env) => $GLOBAL.create(env) };" \
  --outfile="$OUT"

# macOS 是 shasum -a 1;Linux 是 sha1sum。
if command -v sha1sum >/dev/null 2>&1; then
  REV="$(sha1sum "$OUT" | cut -c1-12)"
else
  REV="$(shasum -a 1 "$OUT" | cut -c1-12)"
fi

echo "src:   $SRC"
echo "built: $OUT ($(wc -c <"$OUT" | tr -d ' ') B)"
echo "rev:   $REV"
echo "清单:  curl -s http://127.0.0.1:12000/plugins/manifest.json   # 现扫目录,无需重启 API"