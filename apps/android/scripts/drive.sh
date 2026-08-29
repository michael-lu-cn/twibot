#!/usr/bin/env bash
# 用法:
#   drive.sh tap-text "<按钮文字前缀>"   定位并点击
#   drive.sh dump                        输出当前界面 XML
KEY="$HOME/.ssh/cordis_face_ed25519"
ACTION="$1"; shift
case "$ACTION" in
  tap-text)
    XML=$(ssh -i "$KEY" grant@172.16.74.1 "bash --noprofile --norc -c 'ADB=/opt/homebrew/share/android-commandlinetools/platform-tools/adb; \$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; \$ADB shell cat /sdcard/ui.xml'" 2>/dev/null)
    COORD=$(printf '%s' "$XML" | python3 -c "
import re,sys
s=sys.stdin.read()
target=sys.argv[1]
for m in re.finditer(r'text=\"([^\"]*)\"[^>]*bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"', s):
    if m.group(1).startswith(target):
        x1,y1,x2,y2=map(int,m.groups()[1:])
        print((x1+x2)//2,(y1+y2)//2); break
" "$1")
    [ -z "$COORD" ] && { echo "NOT_FOUND: $1" >&2; exit 1; }
    X=$(echo $COORD | cut -d' ' -f1); Y=$(echo $COORD | cut -d' ' -f2)
    echo "tap($X,$Y) <- $1" >&2
    ssh -i "$KEY" grant@172.16.74.1 "bash --noprofile --norc -c 'ADB=/opt/homebrew/share/android-commandlinetools/platform-tools/adb; \$ADB shell input tap $X $Y'" 2>/dev/null
    ;;
  dump)
    ssh -i "$KEY" grant@172.16.74.1 "bash --noprofile --norc -c 'ADB=/opt/homebrew/share/android-commandlinetools/platform-tools/adb; \$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; \$ADB shell cat /sdcard/ui.xml'" 2>/dev/null
    ;;
esac
