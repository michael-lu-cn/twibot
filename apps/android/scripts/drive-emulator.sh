#!/usr/bin/env bash
# 模拟器驱动工具(远端 Mac 上的 emulator-5554)。
# 用法:
#   drive-emulator.sh launch                 冷启动 App 并等 UI 就绪
#   drive-emulator.sh dump <输出文件>        抓当前 UI XML 到本地文件
#   drive-emulator.sh tap-text "<前缀>"      按可见文本定位并点击
#   drive-emulator.sh type <文本>            keyevent 逐键输入(仅 ASCII;先点焦点)
#   drive-emulator.sh hide-keyboard          ESC 收起 IME(点击前必做,隐形 IME 会吃 tap)
#   drive-emulator.sh shot <输出.png>        截屏拉回本地
set -euo pipefail
KEY="$HOME/.ssh/cordis_face_ed25519"
REMOTE="grant@172.16.74.1"
ADB="/opt/homebrew/share/android-commandlinetools/platform-tools/adb"
DEV="-s emulator-5554"

remote() { ssh -F none -i "$KEY" -o StrictHostKeyChecking=accept-new "$REMOTE" bash --noprofile --norc 2>/dev/null; }

dump_remote() {
  {
    echo "$ADB $DEV shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 </dev/null"
    echo "$ADB $DEV shell cat /sdcard/ui.xml </dev/null"
  } | remote
}

cmd="${1:-}"; shift || true
case "$cmd" in
  launch)
    {
      echo "ADB=$ADB"
      echo "DEV=$DEV"
      echo '$ADB $DEV shell am force-stop org.twibot.face </dev/null'
      echo sleep 1
      echo "$ADB $DEV shell am start -n org.twibot.face/.MainActivity </dev/null"
      for i in 1 2 3 4 5 6; do
        echo sleep 4
        echo "if \$ADB $DEV shell uiautomator dump /sdcard/ui.xml </dev/null 2>&1 | grep -q dumped; then echo READY-$i; exit 0; fi"
      done
      echo exit 1
    } | remote
    ;;
  dump)
    dump_remote > "$1"
    wc -c "$1"
    ;;
  tap-text)
    TARGET="$1"
    COORD=$(dump_remote | python3 -c "
import re, sys
target = sys.argv[1]
for m in re.finditer(r'text=\"([^\"]*)\"[^>]*bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"', sys.stdin.read()):
    if m.group(1).startswith(target):
        x1,y1,x2,y2 = map(int, m.groups()[1:])
        print((x1+x2)//2, (y1+y2)//2); break
" "$TARGET")
    [ -z "$COORD" ] && { echo "NOT_FOUND: $TARGET" >&2; exit 1; }
    echo "tap($COORD) <- $TARGET"
    printf '%s\n' "$ADB $DEV shell input tap $COORD </dev/null" | remote
    ;;
  type)
    TEXT="$1"
    {
      echo 'KEYS=$(python3 -c "
import sys
for ch in sys.argv[1]:
    print(ord(ch.lower()) - 97 + 36 if ch.isalpha() else 7 if ch == chr(32) else None, end=\" \")
" "'"$TEXT"'")'
      echo "\$ADB $DEV shell input keyevent \$KEYS </dev/null"
    } | remote
    ;;
  hide-keyboard)
    printf '%s\n' "$ADB $DEV shell input keyevent 111 </dev/null" | remote
    ;;
  shot)
    ssh -F none -i "$KEY" "$REMOTE" "$ADB $DEV exec-out screencap -p" 2>/dev/null > "$1"
    file "$1" | head -1
    ;;
  *)
    echo "unknown command: $cmd" >&2; exit 1 ;;
esac
