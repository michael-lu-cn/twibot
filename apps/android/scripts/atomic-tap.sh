#!/usr/bin/env bash
# 用法: atomic-tap.sh "<文本前缀>" —— 远端一次会话内完成 定位→点击
KEY="$HOME/.ssh/cordis_face_ed25519"
ssh -i "$KEY" grant@172.16.74.1 bash --noprofile --norc <<REMOTE 2>/dev/null
ADB=/opt/homebrew/share/android-commandlinetools/platform-tools/adb
\$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
\$ADB shell cat /sdcard/ui.xml > /tmp/ui.xml
python3 - "$1" <<'PY'
import re, subprocess, sys
target = sys.argv[1]
s = open('/tmp/ui.xml').read()
for m in re.finditer(r'text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', s):
    if m.group(1).startswith(target):
        x1,y1,x2,y2 = map(int, m.groups()[1:])
        cx, cy = (x1+x2)//2, (y1+y2)//2
        print(f'tapping {cx},{cy} <- {m.group(1)[:40]}', file=sys.stderr)
        subprocess.run(['adb','shell','input','tap',str(cx),str(cy)], executable=None) if False else None
        break
else:
    sys.exit(3)
PY
echo "---"
