#!/usr/bin/env bash
# 用法：bash patch-android-manifest.sh <apps/shell 路径>
# 在 expo prebuild 之后执行（expo prebuild 只写 debug 变体，release 需要手动固化）：
# 1. usesCleartextTraffic=true —— release 走 http 宿主必须允许明文；
# 2. twibot:// scheme intent-filter —— M3 深链直达（书签/分组/用户页）。
set -euo pipefail
SHELL_DIR="${1:?usage: $0 <apps/shell dir>}"
MF="$SHELL_DIR/android/app/src/main/AndroidManifest.xml"
[[ -f "$MF" ]] || { echo "no $MF — run expo prebuild first" >&2; exit 1; }

# 1) cleartext
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
  echo "cleartext already present"
fi

# 2) deep link scheme
if ! grep -q 'scheme="twibot"' "$MF"; then
  python3 - "$MF" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
anchor = '<intent-filter>'
idx = s.find(anchor, s.find('<activity'))
if idx == -1:
    print('WARN: no <intent-filter> after <activity>, insert skipped')
else:
    insert = (
        '<intent-filter>\n'
        '                <action android:name="android.intent.action.VIEW" />\n'
        '                <category android:name="android.intent.category.DEFAULT" />\n'
        '                <category android:name="android.intent.category.BROWSABLE" />\n'
        '                <data android:scheme="twibot" />\n'
        '            </intent-filter>\n'
        '            '
    )
    s = s[:idx] + insert + s[idx:]
    open(p, 'w').write(s)
    print('twibot:// intent-filter wired')
PY
else
  echo "intent-filter already present"
fi