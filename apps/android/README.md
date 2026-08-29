# twibot android face —— Cordis × RN 插件化 Android 客户端

> 定位：twibot 的**第三张 face**（宿主树 Node API + 浏览器树 Web + 安卓树本工程）。
> 架构沿袭 [cordis/android-face](../../../cordis/android-face)（Expo SDK 57 + RN 0.86 + Repack 5.3 + cordis-kernel），
> 工作区名已改名 `@twibot/face-*`，应用 id `org.twibot.face`。
> 北极星不变：**客户端 = 带缓存的投影基座；功能 = 一组插件；插件各自带 rev，后台出新版实时热更新，永不换包。**

## 进度（M0 起步）

- **M0（进行中）**：壳工程复制与改名；`ui-hello` 空壳插件（验证 face → 宿主 `/api/credential/status` 链路）；
  `api-client`（信封契约，对齐 web `lib/api.ts`）与 `router`（深链语义，对齐 web `lib/router.ts`）纯逻辑 + vitest。
- M1+：ui-auth / ui-feed / 用户主页 → M2 关注/批量/分组/书签（按月分组+月份导航）→ M3 roster/slot 装配、
  深链路由、外链、主题 → M4 验收（Node vitest + 模拟器截图，F1–F10 与 Web 对齐）。
- 详细计划见仓库 `docs/安卓版计划-基于cordis与android-face.md`。

## 结构

```
packages/face-cordis-kernel    vendored cordis 单文件预打包（70KB + 补丁 banner）
packages/face-protocol-client  dsh 网关信封协议客户端（保留，twibot 暂用 REST api-client）
packages/face-priority-slot    priority 遮蔽 slot 核心
apps/shell                     Expo 壳工程 + Repack 配置（本工程全部业务所在）
apps/remote-chunk-demo         远端插件 chunk 目录（P2 热更新用）
scripts/                       构建辅助（publish-chunk、drive-emulator、patch-gradle-mirrors…）
docs/                          android-face 历史报告（P0–S2 参考）
```

## 快速开始（构建）

```bash
# 依赖（本工程是独立 npm workspace，不挂 pnpm）
cd apps/android && npm install
npm run build --workspaces --if-present   # 先产 cordis-kernel dist

# 壳工程内
cd apps/shell
npx expo prebuild -p android              # 生成 android/ 原生工程
bash ../scripts/patch-gradle-mirrors.sh .  # 镜像 + hermesc shim（aarch64 Linux）

# 构建（release 内嵌 bundle，M0 验收用；debug 走 Metro 热更新）
cd android && ./gradlew assembleRelease   # 或 assembleDebug
```

## 连接拓扑（M0 已验证：模拟器 → 宿主 API 全链路）

- 模拟器经 ssh 驱动（`scripts/drive-emulator.sh`，key `~/.ssh/cordis_face_ed25519`，远端 `grant@172.16.74.1`）。
- 本机 twibot API 在 `127.0.0.1:12000`；App 默认宿主 `http://10.0.2.2:12000`（模拟器 NAT → Mac）。
- 链路：模拟器 `10.0.2.2` → Mac `127.0.0.1:12000`（Mac 侧 `tcp-relay.py`）→ 容器
  `172.16.74.11:12000`（容器侧 `tcp-relay.py`）→ twibot API。
  ```bash
  # 容器侧（本机）：
  python3 scripts/tcp-relay.py 172.16.74.11 12000 127.0.0.1 12000 &
  # Mac 侧（ssh 到 grant@172.16.74.1）：
  python3 scripts/tcp-relay.py 127.0.0.1 12000 172.16.74.11 12000 &
  ```
- M0 验收：release 包内嵌 JS、自动启动（`App.tsx` 无条件 boot 默认宿主），ui-hello 直连
  `/api/credential/status` 展示「宿主已连通 ✔」（截图 `docs/android-m0-shell.png`）。

## 验收纪律（继承 android-face）

- Node 档 vitest（`apps/shell/tests/`，react-native 走 stub）+ 设备档截图（`drive-emulator.sh shot`）双层。
- roster 删一行 = 能力消失；缺依赖 fail loud；热更新 url@rev 缓存幂等装配。