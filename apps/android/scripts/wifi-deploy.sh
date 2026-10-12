#!/usr/bin/env bash
# twibot face 真机无线（WiFi）部署与调试入口 —— 配对一次之后，装机/启动/看日志都在这。
#
#   scripts/wifi-deploy.sh usb [release|debug]              有线（USB）装机：reverse + 安装 + 启动
#   scripts/wifi-deploy.sh pair <IP:配对端口> <6位配对码>   首次配对（每台手机一次）
#   scripts/wifi-deploy.sh connect <IP:端口>                建立/刷新无线连接（一般用不着，见 discover）
#   scripts/wifi-deploy.sh discover                         靠 mDNS 找回配对过的手机并重连
#   scripts/wifi-deploy.sh status                           看连上的设备与 reverse 列表
#   scripts/wifi-deploy.sh build [release|debug]            构建 arm64-v8a APK
#   scripts/wifi-deploy.sh deploy [release|debug]           reverse + 安装 + 启动（默认 release）
#   scripts/wifi-deploy.sh logs                            跟日志（ReactNativeJS + 崩溃）
#
# 为什么换局域网不用改任何东西：App 侧宿主地址走 `adb reverse tcp:12000`，手机访问自己的
# 127.0.0.1:12000 由 adb 隧道送回 Mac 的 127.0.0.1:12000，与两端 IP 无关。
# 环境变量：SERIAL=<adb 地址> 指定设备；API_PORT / METRO_PORT 改端口。
set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
ADB="${ADB:-$ANDROID_HOME/platform-tools/adb}"
ANDROID_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRADLE_DIR="$ANDROID_DIR/apps/shell/android"
API_PORT="${API_PORT:-12000}"
METRO_PORT="${METRO_PORT:-8081}"
PKG="org.twibot.face"

usage() { sed -n '2,/^set /p' "${BASH_SOURCE[0]}" | sed '$d; s/^# \{0,1\}//'; }

# 真机优先：显式 SERIAL > 唯一/第一个非 emulator 的在线设备。
pick_serial() {
  if [[ -n "${SERIAL:-}" ]]; then printf '%s\n' "$SERIAL"; return; fi
  local name
  name="$("$ADB" devices | awk 'NR>1 && $2=="device" && $1 !~ /^emulator-/ {print $1; exit}')"
  if [[ -z "$name" ]]; then
    { echo "✗ 没有在线的真机。"; "$ADB" devices; echo "  首次：$0 pair <IP:配对端口> <码>；已配对过：$0 discover"; } >&2
    exit 1
  fi
  printf '%s\n' "$name"
}

cmd_pair() {
  local addr="${1:?用法: $0 pair <IP:配对端口> <6位配对码>}"
  local code="${2:?缺少 6 位配对码（手机上：开发者选项 → 无线调试 → 使用配对码配对设备）}"
  "$ADB" pair "$addr" "$code"
  echo "→ 配对完成。接着用手机上显示的「IP 地址和端口」执行：$0 connect <IP:端口>"
}

cmd_connect() {
  local addr="${1:?用法: $0 connect <IP:端口>}"
  "$ADB" connect "$addr"
  "$ADB" devices
}

# 配对只做一次（密钥交换）：手机侧把本机公钥记进 /data/misc/adb/adb_keys，本机是 ~/.android/adbkey。
# 之后端口每次都会变，但不用再配对：adb 自带 mDNS 自动连接（ADB_MDNS_AUTO_CONNECT 默认 adb-tls-connect）
# 会在同一局域网里把配对过的手机自己接回来。这里做显式发现/重连兜底。
cmd_discover() {
  local out; out="$("$ADB" mdns services 2>/dev/null || true)"
  printf '%s\n' "$out"
  local addr
  for addr in $(printf '%s\n' "$out" | awk '/_adb-tls-connect\._tcp/ {print $NF}'); do
    echo "→ adb connect $addr"
    "$ADB" connect "$addr" || true
  done
  local pairing
  pairing="$(printf '%s\n' "$out" | awk '/_adb-tls-pairing\._tcp/ {print $NF}' | head -1)"
  [[ -n "$pairing" ]] && echo "ℹ 手机正处于配对模式：$0 pair $pairing <6位配对码>"
  "$ADB" devices
}

# 有线（USB）真机：serial 形如 R5CTxxxx，不含 ':'，也不是 emulator-。
pick_usb_serial() {
  if [[ -n "${SERIAL:-}" ]]; then printf '%s\n' "$SERIAL"; return; fi
  local out; out="$("$ADB" devices)"
  local name
  name="$(printf '%s\n' "$out" | awk 'NR>1 && $1 !~ /:/ && $1 !~ /^emulator-/ && $2=="device" {print $1; exit}')"
  if [[ -z "$name" ]]; then
    {
      echo "✗ 没看到 USB 真机。当前 adb 状态："
      printf '%s\n' "$out"
      if printf '%s\n' "$out" | grep -q 'unauthorized'; then
        echo "  → 手机显示「未授权」：解锁屏幕，勾「一律允许使用这台计算机进行调试」，再点「允许」。"
      else
        echo "  → 逐条检查：① 数据线插在手机和 Mac 上（别用只能充电的线）"
        echo "     ② 手机：设置 → 关于手机 → 连点「版本号」7 次 → 开发者选项 → 打开「USB 调试」"
        echo "     ③ 小米/红米：还要打开「USB 调试（安全设置）」；④ 插上后把「USB 用途」选成 文件传输/MTP"
      fi
    } >&2
    exit 1
  fi
  printf '%s\n' "$name"
}

# 有线模式：串行链走 USB，其余与 deploy 完全一致（reverse 隧道 + 安装 + 启动）。
cmd_usb() {
  local variant="${1:-release}"
  local name; name="$(pick_usb_serial)"
  local abi ver sdk
  abi="$("$ADB" -s "$name" shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r')"
  ver="$("$ADB" -s "$name" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r')"
  sdk="$("$ADB" -s "$name" shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r')"
  echo "→ USB 设备 $name · Android $ver (API $sdk) · ABI $abi"
  if [[ "$abi" != 'arm64-v8a' ]]; then
    echo "⚠ APK 只带 arm64-v8a（$abi 设备装不上，会报 INSTALL_FAILED_NO_MATCHING_ABIS）"
  fi
  SERIAL="$name" cmd_deploy "$variant"
}

cmd_status() {
  "$ADB" devices -l
  local name
  name="$(pick_serial)" || exit 0
  echo "reverse 列表（$name）:"
  "$ADB" -s "$name" reverse --list || true
}

cmd_build() {
  local variant="${1:-release}"
  local task='assembleRelease'
  [[ "$variant" == 'debug' ]] && task='installDebug'
  echo "→ gradlew $task （arm64-v8a）"
  # 只编 arm64-v8a：真机几乎都是 arm64，默认四个 ABI 会白等几倍时间。
  ( cd "$GRADLE_DIR" &&
    JAVA_HOME="$JAVA_HOME" ANDROID_HOME="$ANDROID_HOME" \
    PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH" \
    ./gradlew "$task" -PreactNativeArchitectures=arm64-v8a --console=plain )
}

cmd_deploy() {
  local variant="${1:-release}"
  local name; name="$(pick_serial)"
  echo "→ 设备 $name（$variant）"

  if curl -fsS -m 3 "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1; then
    echo "✓ API 在线 http://127.0.0.1:$API_PORT"
  else
    echo "⚠ API 未响应 http://127.0.0.1:$API_PORT/api/health —— reverse 只是隧道，后端得先在 Mac 上跑 pnpm dev"
  fi

  # 手机 127.0.0.1:12000 → Mac 127.0.0.1:12000；与两端局域网 IP 无关。
  "$ADB" -s "$name" reverse "tcp:$API_PORT" "tcp:$API_PORT" >/dev/null
  if [[ "$variant" == 'debug' ]]; then
    "$ADB" -s "$name" reverse "tcp:$METRO_PORT" "tcp:$METRO_PORT" >/dev/null
  fi
  echo "✓ reverse: $("$ADB" -s "$name" reverse --list | tr '\n' ' ')"

  local apk
  if [[ "$variant" == 'debug' ]]; then
    apk="$GRADLE_DIR/app/build/outputs/apk/debug/app-debug.apk"
  else
    apk="$GRADLE_DIR/app/build/outputs/apk/release/app-release.apk"
  fi
  if [[ ! -f "$apk" ]]; then
    echo "→ 缺 $apk，先构建"
    cmd_build "$variant"
  fi

  "$ADB" -s "$name" install -r "$apk"
  "$ADB" -s "$name" shell am start -n "$PKG/.MainActivity" >/dev/null
  echo "✓ 已安装并启动（App 冷启动自动探测宿主，无需手点）"
  echo "  日志：$0 logs"
}

cmd_logs() {
  local name; name="$(pick_serial)"
  "$ADB" -s "$name" logcat -v time ReactNativeJS:V AndroidRuntime:E '*:S'
}

case "${1:-}" in
  pair)    shift; cmd_pair "$@" ;;
  connect) shift; cmd_connect "$@" ;;
  discover) cmd_discover ;;
  usb)     shift; cmd_usb "$@" ;;
  status)  cmd_status ;;
  build)   shift; cmd_build "$@" ;;
  deploy)  shift; cmd_deploy "$@" ;;
  logs)    cmd_logs ;;
  -h|--help|'') usage ;;
  *) echo "未知子命令: $1" >&2; usage; exit 2 ;;
esac
