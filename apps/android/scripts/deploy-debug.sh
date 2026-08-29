#!/usr/bin/env bash
# 部署 debug 包(走 Metro 热更新的日常迭代包)到远端模拟器。
# 已包含:卸载旧包 → 装 debug → 预写 dev server 指向公网 Metro(debug_http_host)。
# 用法: bash scripts/deploy-debug.sh
set -euo pipefail
KEY="$HOME/.ssh/cordis_face_ed25519"
REMOTE="grant@172.16.74.1"
ADB="/opt/homebrew/share/android-commandlinetools/platform-tools/adb"
APK="$(dirname "$0")/../apps/shell/android/app/build/outputs/apk/debug/app-debug.apk"

PREFS='<?xml version='"'"'1.0'"'"' encoding='"'"'utf-8'"'"' standalone='"'"'yes'"'"' ?>
<map>
    <string name="debug_http_host">metro.dsh.port.dpdns.org:80</string>
</map>'

echo "==> scp debug apk(~136MB)"
scp -F none -i "$KEY" -o StrictHostKeyChecking=accept-new "$APK" "$REMOTE:/tmp/twibot-face-debug.apk"
printf '%s' "$PREFS" | ssh -F none -i "$KEY" "$REMOTE" 'cat > /tmp/twibot-prefs.xml'

echo "==> 卸载 → 安装 → 预写 dev server"
{
  echo 'ADB=/opt/homebrew/share/android-commandlinetools/platform-tools/adb'
  echo '$ADB -s emulator-5554 uninstall org.twibot.face </dev/null || true'
  echo '$ADB -s emulator-5554 install /tmp/twibot-face-debug.apk </dev/null'
  echo "\$ADB -s emulator-5554 shell \"run-as org.twibot.face sh -c 'mkdir -p shared_prefs && cat > shared_prefs/org.twibot.face_preferences.xml'\" < /tmp/twibot-prefs.xml"
  echo '$ADB -s emulator-5554 shell "run-as org.twibot.face cat shared_prefs/org.twibot.face_preferences.xml" </dev/null'
} | ssh -F none -i "$KEY" "$REMOTE" bash --noprofile --norc 2>/dev/null

ssh -F none -i "$KEY" "$REMOTE" 'rm -f /tmp/twibot-face-debug.apk /tmp/twibot-prefs.xml'
echo "==> 完成。启动 App 后 JS 从 http://metro.dsh.port.dpdns.org 现拉;改码后 POST /reload 即生效。"
