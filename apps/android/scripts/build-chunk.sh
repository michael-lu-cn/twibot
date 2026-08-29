#!/usr/bin/env bash
# 远端插件 chunk 构建管线:正常 TSX → IIFE 裸脚本 + __face_plugins 注册行。
#
# 用法: bash scripts/build-chunk.sh <name>     # src=<name>.src.tsx → dist/<name>.client.js
# 产物末尾自动打印 rev(sha1-12),即 roster remote 行所需的修订号。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEMO="$(cd "$HERE/../apps/remote-chunk-demo" && pwd)"
NAME="${1:?usage: build-chunk.sh <name>}"
SRC="$DEMO/src/$NAME.src.tsx"
OUT="$DEMO/dist/$NAME.client.js"

[ -f "$SRC" ] || { echo "no source: $SRC" >&2; exit 1; }

GLOBAL="__face_chunk_$(echo "$NAME" | tr '-' '_')"
"$HERE/../node_modules/.bin/esbuild" "$SRC" \
  --format=iife \
  --global-name="$GLOBAL" \
  --jsx=transform \
  --target=es2020 \
  --legal-comments=none \
  "--footer:js=globalThis.__face_plugins = globalThis.__face_plugins || {};globalThis.__face_plugins['$NAME'] = { mount: (env) => $GLOBAL.create(env) };" \
  --outfile="$OUT"

REV=$(sha1sum "$OUT" | cut -c1-12)
echo "built: $OUT"
echo "rev:   $REV"
echo "roster 行示例:"
echo "  { id: '$NAME', module: '$NAME', remote: { url: 'http://10.0.2.2:8099/$NAME.client.js', rev: '$REV' } },"
