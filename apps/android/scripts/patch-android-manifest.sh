#!/usr/bin/env bash
# 用法：bash patch-android-manifest.sh <apps/shell 路径>
# 在 expo prebuild 之后执行：给 main AndroidManifest 的 application 加
# usesCleartextTraffic=true（expo prebuild 只写入 debug 变体；release 走 http
# 宿主必须显式允许明文流量）。
set -euo pipefail
SHELL_DIR="${1:?usage: $0 <apps/shell dir>}"
MF="$SHELL_DIR/android/app/src/main/AndroidManifest.xml"
[[ -f "$MF" ]] || { echo "no $MF — run expo prebuild first" >&2; exit 1; }

if ! grep -q 'usesCleartextTraffic' "$MF"; then
  python3 - "$MF" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
if 'android:usesCleartextTraffic="true"' not in s:
    s = s.replace('<application ', '<application android:usesCleartextTraffic="true" ', 1)
open(p, 'w').write(s)
print('usesCleartextTraffic=true wired')
PY
else
  echo "already present"
fi