#!/usr/bin/env bash
# 部署 release APK 到远端模拟器并启动（M0/里程碑验收件）。
# 依赖：ssh key ~/.ssh/cordis_face_ed25519、远端 Mac 模拟器 emulator-5554。
# 用法: bash deploy-release.sh [--shot <out.png>]
set -euo pipefail
KEY="$HOME/.ssh/cordis_face_ed25519"
REMOTE="grant@172.16.74.1"
ADB="/opt/homebrew/share/android-commandlinetools/platform-tools/adb"
APK="$(cd "$(dirname "$0")/.." && pwd)/apps/shell/android/app/build/outputs/apk/release/app-release.apk"

[[ -f "$APK" ]] || { echo "no release apk: $APK — 先 ./gradlew assembleRelease" >&2; exit 1; }

echo "==> scp release apk"
scp -F none -i "$KEY" -o StrictHostKeyChecking=accept-new "$APK" "$REMOTE:/tmp/twibot-release.apk"

remote() { ssh -F none -i "$KEY" "$REMOTE" bash --noprofile --norc 2>/dev/null; }

echo "==> 卸载 → 安装 → 启动"
{
  echo "ADB=$ADB"
  echo '$ADB -s emulator-5554 uninstall org.twibot.face </dev/null || true'
  echo '$ADB -s emulator-5554 install /tmp/twibot-release.apk </dev/null'
  echo '$ADB -s emulator-5554 shell am start -n org.twibot.face/.MainActivity </dev/null'
} | remote

if [ "${1:-}" = "--shot" ]; then
  OUT="${2:-/tmp/twibot-m0.png}"
  echo "==> 等待 UI 就绪并截图 → $OUT"
  {
    echo 'ADB=$ADB'
    echo 'sleep 6'
    echo "\$ADB -s emulator-5554 exec-out screencap -p > /tmp/twibot-shot.png </dev/null"
  } | remote
  scp -F none -i "$KEY" "$REMOTE:/tmp/twibot-shot.png" "$OUT"
  echo "截图已存: $OUT"
fi

ssh -F none -i "$KEY" "$REMOTE" 'rm -f /tmp/twibot-release.apk /tmp/twibot-shot.png'