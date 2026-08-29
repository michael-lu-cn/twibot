# Android M0 报告：壳工程落地 + face→宿主链路验收

> 日期：2026-08-29 ｜ 状态：✅ PASS
> 关联计划：[安卓版计划-基于cordis与android-face.md](./安卓版计划-基于cordis与android-face.md)

## 结论

**M0 全部通过**：android-face 架构平移进 twibot（`apps/android`），release 空壳 APK 在远端模拟器上跑通，
`ui-hello` 插件直连本机 twibot API 并拿到真实 credential 数据（`configured=true, source=file`）。
Node 档 56/56 测试通过（含新增 api-client/router 24 项）。

## 交付物

| 项 | 内容 | 证据 |
|---|---|---|
| 壳工程 | Expo SDK57 / RN 0.86 / Repack 5.3 + cordis-kernel，改名 `@twibot/face-*`，应用 id `org.twibot.face` | `apps/android/` |
| 纯逻辑 | `lib/api-client.ts`（信封契约对齐 web）+ `lib/router.ts`（深链语义对齐 web） | vitest 12 项 |
| 空壳插件 | `ui-hello`：config.baseUrl 注入，直连 `/api/credential/status` | 设备截图 `docs/android-m0-shell.png` |
| 构建链 | Gradle 9.3.1（复用缓存发行版）+ hermesc shim + 阿里云镜像 + cleartext patch | `patch-*.sh` |
| 连接链路 | 模拟器 `10.0.2.2:12000` → Mac relay → 容器 relay → 127.0.0.1:12000 | `scripts/tcp-relay.py` ×2 |

## 关键决策与踩坑记录

1. **face 定位**：Playwright 无法进安卓，抓取留在宿主树；安卓只做投影基座（与 android-face 北极星一致）。
2. **命名**：`@face/*` → `@twibot/face-*`；`dev.cordis.face` → `org.twibot.face`（app.json 与 scripts 同步）。
3. **pnpm/npm 隔离**：android-face 用 npm workspaces；`pnpm-workspace.yaml` 排除 `apps/android`（避免 pnpm 强解析）。
4. **cordis-kernel 构建**：tsup 顶层 `alias` 不生效 → 改用 `esbuildOptions`；vendor 源码从 `../cordis/tmp-research` 复制并修正相对路径。
5. **gradle wrapper 下载卡死**：腾讯镜像极慢（20KB/s）且官方源超时→ 直接复用已解压的 Gradle 9.3.1 发行版 bin 构建（绕过 wrapper）。
6. **release 无 cleartext**：expo prebuild 只给 debug manifest 写 `usesCleartextTraffic`，release fetch http 被拦 →
   `patch-android-manifest.sh` 固化（M0 关键 bug）。
7. **adb reverse 数据断裂**：Mac adb 34 的 reverse 只建立不传数据（对照实验：模拟器→Mac 本地 http.server 无请求）。
   → 弃用 reverse，改模拟器 NAT `10.0.2.2:12000`（Mac 上 tcp-relay 转发到容器），验证通过。
8. **自动启动**：release 包也自动 boot 默认宿主（去掉 `__DEV__` 条件），验收零交互。

## 验收条目（对齐计划 A1/A2 与设备档）

| # | 项 | 结果 |
|---|---|---|
| A1 | `groupByMonth`/路由纯函数 vitest | ✅ 24/24（api-client 7 + router 5 + chunk-cache 6 + inventory-roster 6） |
| A2 | api-client 信封 mock 测试 | ✅ 7/7（Ok/Err/NETWORK/body/图片代理） |
| A3 | roster 删行机制 | ✅ inventory-roster 6/6（M0 基线 ui-hello） |
| A4 | chunk 缓存管线 | ✅ chunk-cache 6/6（沿用 android-face 实现） |
| A5 | 首启自动装配 → ui-hello 上屏 | ✅ UI dump：𝕏 twibot face + 宿主地址 + API 状态 |
| A6 | face→宿主链路（真实数据） | ✅ 「宿主已连通 ✔」「configured=true · source=file」 |

## 遗留

- `tests/legacy-dsh/`：android-face 继承的 dsh 特性测试暂归档（依赖旧基线），M1 业务插件落地后回归/改写。
- UI dump 验证为文本级；像素级截图 `docs/android-m0-shell.png` 已存档供人工确认。
- 模拟器 headless（-no-window），日常驱动走 `drive-emulator.sh`。