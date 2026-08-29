#!/usr/bin/env bash
# 远端插件 chunk 自动化发布:构建 → rev 自动进 Metro manifest → 设备热更。
#
# 用法: bash scripts/publish-chunk.sh <name> [--no-reload]
#   例: bash scripts/publish-chunk.sh drawer-sessions
#
# 原理(与 README「连接拓扑」一致,勿再试错):
#   - 构建产物落在 apps/remote-chunk-demo/dist/,Metro 的 /plugins/*.client.js
#     与 /plugins/manifest.json(含 sha1-12 rev)自动服务该目录;
#   - 客户端 boot 后由 ui-frame 的 plugin-updater 读 manifest 装配 roster 行,
#     rev 变化 → 卸旧装新(失效 url@rev 缓存 → 重拉 chunk);
#   - POST /reload 让 debug 包重载 JS → 启动装配自动拉最新版。
#   因此"发布" = 构建 + reload,设备侧零改动、永不换包。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="${1:?usage: publish-chunk.sh <name> [--no-reload]}"
RELOAD=1
[ "${2:-}" = "--no-reload" ] && RELOAD=0

"$HERE/build-chunk.sh" "$NAME"

echo "==> manifest: http://metro.dsh.port.dpdns.org/plugins/manifest.json (rev 自动更新)"
if [ "$RELOAD" = 1 ]; then
  echo "==> POST /reload → 设备热重载(新 rev 生效)"
  # 本机与 Mac 的 shell 都有代理环境变量:一律 --noproxy "*" 防劫持
  curl --noproxy "*" -sS -m 10 -o /dev/null -w "reload http %{http_code}\n" \
    -X POST http://metro.dsh.port.dpdns.org/reload \
  || echo "WARN: reload 失败(Metro 未起?bash scripts/start-metro.sh 拉起后重试)"
fi
echo "==> 发布完成:$NAME(设备端 drawer 打开即新版本)"