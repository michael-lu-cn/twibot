#!/usr/bin/env bash
# Metro 存活保障:启动(或重启)expo dev server 并脱离会话存活。
# 用法: bash scripts/start-metro.sh          # 已在跑则跳过
#       bash scripts/start-metro.sh restart  # 杀掉旧的再起
set -euo pipefail
SHELL_DIR="$(cd "$(dirname "$0")/../apps/shell" && pwd)"
PORT=8081
LOG="$SHELL_DIR/.expo/metro.log"

if pgrep -f "expo start --port $PORT" >/dev/null 2>&1 && [ "${1:-}" != "restart" ]; then
  echo "metro already running (pid $(pgrep -f "expo start --port $PORT" | head -1))"
  exit 0
fi

pkill -f "expo start --port $PORT" 2>/dev/null || true
sleep 1

cd "$SHELL_DIR"
setsid nohup npx expo start --port $PORT --offline >> "$LOG" 2>&1 &
echo "started, pid $! — log: $LOG"

# 就绪探针(最多 30s)
for i in $(seq 1 15); do
  sleep 2
  if curl -s --noproxy "*" -m 2 "http://127.0.0.1:$PORT/status" | grep -q running; then
    echo "metro is up: http://127.0.0.1:$PORT (公网: http://metro.dsh.port.dpdns.org)"
    exit 0
  fi
done
echo "WARN: 未在 30s 内就绪,查看 $LOG" >&2
exit 1
