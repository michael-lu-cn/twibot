# twibot 安卓版计划报告 —— 基于 Cordis 插件化 + android-face 架构

> 日期：2026-08-29 ｜ 状态：计划（待评审）
> 参考：[android-face](file:///home/grant/orca/projects/cordis/android-face/README.md)、cordis-react-native-android 系列报告、[twibot 需求文档 1.0](./需求文档-1.0.md)、[本轮迭代总结](./迭代总结-书签完善与导航.md)

---

## 1. 背景与目标

twibot 目前是「宿主树（Node cordis 插件）+ 浏览器树（React Web）」两棵树的架构，功能已覆盖推荐流、关注、智能分组、书签（按月分组+右侧导航）、用户主页、认证、外链跳转与 URL 路由。

目标：**做一版 Android 客户端，功能与 Web 版保持一致，且沿用同一套架构方式**——即：

> 安卓端不是独立开发的新应用，而是 cordis 体系里的**第三张 face**：复用现有宿主树（REST API 能力面不变），端上采用与 android-face 相同的「壳 + slot/roster + 插件（本地模块插件起步，远端 chunk 热更新）」结构。

## 2. 为什么是「face」而不是「全量移植」

X（Twitter）抓取依赖 Playwright 浏览器自动化（core-session：launch/拦截 GraphQL/滚动/登录墙探测），**Android 上没有可用的 Playwright 浏览器内核**（WebView 无法做页面级自动化与响应拦截替代）。因此：

- ❌ 不可行：把 core-session / sync-feed 等抓取插件原样跑进安卓进程。
- ✅ 可行（本计划）：安卓端只做**投影基座 + 交互层**，数据与抓取全部走宿主树 REST API——这与 android-face 的北极星一致（**客户端 = 带缓存的投影基座**）。

## 3. 参考基准：android-face 可复用资产

android-face（Cordis × Expo × Repack 的安卓 MVP，已在模拟器闭环验证）提供以下**可平移资产**：

| 资产 | 位置 | 用途 |
|---|---|---|
| Expo SDK 57 + RN 0.86 + Repack 5.3 壳工程 | `apps/shell` | 应用壳与 Metro 打包（chunk 化） |
| cordis-kernel 单文件打包 | `packages/cordis-kernel` | 端上跑 cordis 树（roster/slot/插件） |
| roster + slot + 模块表装配 | `apps/shell/src/{roster,modules,chunk-registry,script-loader}.ts` | 删一行配置 = 能力消失；插件装卸 |
| 远端 chunk 热更新（url@rev → AsyncStorage 缓存 → 热挂载） | `apps/shell/src/chunk-registry.ts` + `scripts/publish-chunk.sh` | 新 UI 不换 APK |
| aarch64 Linux 构建链脚本 | `scripts/{patch-gradle-mirrors,drive-emulator,cmakeget,sshpassget}.sh` | 模拟器/真机构建与验收 |
| Node vitest + 设备截图双层验收方法 | `tests/*` + `docs/*.png` | 机制可机械判定 |

> 平移策略：**先搬后改**——把壳、内核装配、chunk 管线、构建脚本整体复制进 twibot，再替换业务插件与数据源。

## 4. twibot 现状盘点（能力面）

### 4.1 宿主树 REST API（127.0.0.1:12000，全部 `{ok,data|error}` 信封）

| 端点 | 方法 | 对应 Web 功能 |
|---|---|---|
| `/api/credential/status`、`/api/credential` | GET/POST/DELETE | 认证设置（保存/状态/清除） |
| `/api/feed`、`/api/feed/sync?limit=` | GET/POST | 推荐流（展示/同步） |
| `/api/following`、`/api/following/sync?limit=` | GET/POST | 关注列表 |
| `/api/batch/user-tweets/sync`、`/api/batch/user-tweets/task/:id` | POST/GET | 批量同步推文（异步任务+进度） |
| `/api/groups/auto`、`/api/groups/override` | GET/POST | 智能分组（生成/手工改分组） |
| `/api/bookmarks`、`/api/bookmarks/sync?limit=` | GET/POST | 书签（全量读/同步） |
| `/api/users/:handle`、`/api/users/:handle/tweets/sync`、`/api/users/:handle/unfollow` | GET/POST | 用户主页/同步推文/取关 |
| `/api/img-proxy?url=` | GET | 图片代理（头像等，SSRF 白名单） |
| `/api/_stats` | GET | 限流/调用统计 |

> 该 API 面**无需任何改动**即可被安卓消费——这是「功能与 Web 保持一致」的保障。

### 4.2 Web 功能 → 安卓映射清单（功能一致性基线）

| # | Web 功能 | 安卓版要求 |
|---|---|---|
| F1 | 认证设置（cookie 粘贴/状态/清除） | 剪贴板粘贴 + 状态点 + 清除；同一套 ERROR_HINTS 文案 |
| F2 | 推荐流（卡片/同步/空态/加载态） | 1:1 平移 |
| F3 | 关注列表（同步/批量进度/取关） | 取关走 `unfollow`；批量任务进度轮询 |
| F4 | 智能分组（chips/成员/改分组/未分组） | 1:1 平移 |
| F5 | 书签（全量加载/按月分组/右侧横杆导航） | 月份分组逻辑复用；横杆导航改 RN 手势/长按模式 |
| F6 | 用户主页（资料/推文/同步/返回） | 1:1 平移 |
| F7 | 用户/推文外链跳转 X 原页 | RN `Linking.openURL`（或 WebView 内打开） |
| F8 | 导航与 URL 对应 | hash 路由 → **深链 scheme + 内部路由**（见 §6.2） |
| F9 | 图片代理 | `<Image source={{uri:'/api/img-proxy?url=…'}}>` |
| F10 | 错误提示与限流 | `ERROR_HINTS` 复用（改为中文文案表常量） |

## 5. 总体架构（三棵树）

```
┌─ 宿主树（Node，不变）────────────────────────────────────┐
│ core-store / core-credential / core-session / sync-feed  │
│ sync-following / smart-groups / api-server  (cordis.yml) │
└───────────────▲──────────────────────────────────────────┘
                │ REST JSON（现有契约，零改动）
        ┌───────┴───────┐
        │               │
┌───────┴───────┐ ┌─────┴──────────────────────────────┐
│ 浏览器树(Web)  │ │ Android 树（本计划新增）              │
│ React+Vite    │ │ Expo 壳 + Repack chunk                │
└───────────────┘ │ cordis-kernel（端上小树）              │
                  │ roster：ui-frame / ui-auth / ui-feed  │
                  │         ui-following / ui-groups /    │
                  │         ui-bookmarks / ui-user        │
                  │ slot：main / nav / drawer             │
                  └───────────────────────────────────────┘
```

- **宿主树零改动**：凡新增能力（如未来的搜索、评论）只要宿主树出新端点，安卓 face 以新插件行接入——"改配置即部署"。
- **安卓树按 android-face 形态**：壳只管原生与装配；功能 = 插件；插件可装卸、可远端热更新。

## 6. 安卓端设计要点

### 6.1 连接拓扑（三种，按序自动尝试）

1. **本机回环**（adb reverse）：`adb reverse tcp:12000 tcp:12000` → `http://127.0.0.1:12000`，开发期默认。
2. **局域网**：设置页可填 `http://<宿主IP>:12000`（与 Web 同源）。
3. **公网隧道**（可选）：沿用 android-face 已验证的隧道方案，设置页保存 baseUrl。

客户端把 baseUrl 存 AsyncStorage；每次请求走统一 `apiClient`（复用 Web `Ok/Err + isOk + ERROR_HINTS` 的信封逻辑，改成 RN fetch）。

### 6.2 导航与 URL 对应（F8）

- Web 的 hash 路由在安卓上映射为：**内部路由（zustand 驱动）+ Android 深链** `twibot://bookmarks`、`twibot://groups`、`twibot://users/<handle>`（App 内 `Linking.addEventListener` 处理）。
- 同一套 `Route` 语义（tab + userHandle）平移到 `lib/router` 的 RN 版，保证「返回/直达」行为与 Web 一致。

### 6.3 书签按月分组与导航（F5）

- `groupByMonth` / `monthKey` 为纯函数，**直接复用**（从 web 平移，不依赖 DOM）。
- 右侧横杆导航在触屏上的等价物：书签页顶部「月份 chips 横滑选择器」+ 列表内月份 sticky 头；长按月份头可弹出月份目录弹层（渲染同一份 `groups` 数据）。

### 6.4 外链跳转（F7）

- 卡片与用户行加「外链」按钮 → `Linking.openURL('https://x.com/…')`（系统浏览器/Chrome 自定义标签页）。
- 与 Web 一致：外链按钮与应用内用户主页入口并存。

### 6.5 主题与组件映射

- Web 的 shadcn/Tailwind 语义（primary/accent/muted/destructive/圆角/卡片分隔线）映射为 RN 轻量主题常量（复用 `theme.ts` 思路）与自绘组件：`TweetCard`、`Sidebar→TabBar`、`NavItem→BottomTab`、`MonthNav→chips/弹层`。
- 平台细节：SafeArea、列表用 FlatList（虚拟化，书签全量数据不卡）、滚动容器等价 `overflow-y-auto`。

### 6.6 插件化与热更新（对齐 android-face 北极星）

- 起步：**本地模块插件**（`roster.ts` 静态行），先跑通三棵树闭环。
- P2+：`ui-*` 转为远端 chunk（`scripts/publish-chunk.sh` 平移），新版本 UI 不换 APK；chunk 按 url@rev 存 AsyncStorage，冷启动命中跳过网络。
- 验收沿用 android-face 的「Node vitest + 模拟器截图」双层模式。

## 7. 工程结构（建议目录，加入现有 monorepo）

```
twibot/
├── apps/
│   ├── api/            # 现有，零改动
│   └── web/            # 现有，零改动
│   └── android/        # 新增：Expo 壳工程（平移 apps/shell）
│       ├── App.tsx / index.ts / src/{roster,modules,chunk-registry,router,apiClient,theme}.ts
│       ├── components/   # RN 版 TweetCard/TabBar/MonthChips/UserRow/…（分组目录）
│       ├── android/      # prebuild 产物（构建脚本沿用 android-face scripts）
│       └── tests/        # vitest：router/groupByMonth/apiClient/chunk 管线
├── packages/
│   ├── face-cordis-kernel/   # 平移 android-face 的 cordis-kernel（vendored 单文件）
│   └── face-protocol-client/ # 信封协议客户端（REST + 可选 WS）
└── docs/安卓版-*
```

> 依赖：android-face 已是 npm workspaces 独立工程，平移时按文件复制 + 改名 `@twibot/face-*`，**先搬后改**。

## 8. 里程碑

| 里程碑 | 内容 | 预算（单人） |
|---|---|---|
| M0 壳落地 | 复制 android-face 壳 + 构建脚本；`pnpm android` 出 debug 包；/api/credential/status 直连验证 | 1–2 天 |
| M1 内容 face | ui-auth + ui-feed + 用户主页（FlatList + apiClient + 图片代理） | 2–3 天 |
| M2 全功能对齐 | 关注/批量进度/智能分组/书签（按月分组+月份导航） | 2–3 天 |
| M3 插件化与路由 | roster/slot 装配收口、深链路由、外链、主题收尾 | 1–2 天 |
| M4 验收与热更新 | Node vitest 全绿 + 模拟器截图逐项对 F1–F10；chunk 热更新闭环 | 1–2 天 |

总预算约 **1.5–2.5 周**（与 twibot M0–M4 节奏一致）。

## 9. 验收标准（对齐 android-face 双层模式）

**Node 档（vitest）**：
- A1 `groupByMonth` 纯函数跨月/未知时间用例通过（与 web 同一份数据）。
- A2 `apiClient` 信封解析（Ok/Err/ERROR_HINTS）mock 测试通过。
- A3 roster 删一行 `ui-bookmarks` → 书签能力消失（机制断言）。
- A4 chunk 管线：url@rev 缓存命中/失效/热挂载单测通过。

**设备档（模拟器，scripts/drive-emulator.sh 截图）**：
- A5 首启 → 认证引导；粘贴 cookie → 状态绿点。
- A6 推荐流/关注/分组/书签四页列表上屏，截图逐张与 Web 版面对比（内容一致）。
- A7 书签按月分组头 + 月份 chips 导航可点击跳转。
- A8 用户行/推文行外链按钮 → 系统浏览器打开 X 原页。
- A9 深链 `twibot://bookmarks` 直达书签页。
- A10 取关、改分组、批量同步进度条与 Web 行为一致。

## 10. 风险与开放问题

| # | 风险/问题 | 对策/倾向 |
|---|---|---|
| R1 | Playwright 无法进安卓 → 抓取必须在宿主树 | 已定 face 定位（§2），不摇摆 |
| R2 | aarch64 Linux 构建链（hermesc shim、aapt2 替换、Gradle 镜像） | 整体平移 android-face 已验证的 scripts |
| R3 | Repack chunk 与 Expo SDK 版本漂移 | 锁定 android-face 同档版本（SDK 57 / RN 0.86 / Repack 5.3），先搬后改 |
| R4 | 图片代理仅白名单（SSRF），头像域名变化 | 沿用现有代理；失败时 AvatarFallback 首字母兜底 |
| R5 | 批量任务长轮询耗电 | 与 Web 相同 4s 间隔，App 退后台暂停轮询 |
| R6 | 「右侧横杆导航」在触屏的形态 | 6.3 已给出 chips + 弹层等价方案，M2 截图确认 |
| R7 | 宿主 baseUrl 变更 | 设置页可编辑 + AsyncStorage 持久化；启动可重试/引导 |
| R8 | 热更新通道（Metro/隧道下 reload 广播不可达） | 沿用「检查更新按钮 + 冷启动自愈」，不承诺 reload 通道 |

## 11. 复用/平移清单

**从 Web 平移（纯逻辑优先，组件翻译）**：
- `lib/api.ts`→`apiClient.ts`（信封/isOk/ERROR_HINTS，去 DOM）
- `lib/format.ts`（fmtCount/fmtAgo/displayUrl/splitLinks/imgProxy 原样）
- `lib/router.ts`（Route 语义保留，hash → 深链）
- `BookmarksView` 的 `groupByMonth/monthKey`（纯函数原样）
- UI 语义（卡片/空态/加载态骨架/错误条）

**从 android-face 平移（壳与管线）**：
- Expo 壳 + Repack 配置 + babel/metro
- cordis-kernel 单文件、roster/modules/chunk-registry/script-loader
- `scripts/{publish-chunk,drive-emulator,patch-gradle-mirrors}.sh`
- 双层验收方法（vitest + 截图）

---

## 附：M0 实施结果（2026-08-29 ✅）

- 壳工程落地：`apps/android`（改名 @twibot/face-*、应用 id org.twibot.face、npm workspace 独立）。
- Node 档 56/56 通过（api-client/router 24 项新增）；`tsc --noEmit` 干净。
- release 包模拟器实测：`ui-hello` 直连 `/api/credential/status` → **宿主已连通 ✔**（configured=true, source=file）。
- 关键修正：Gradle 复用缓存发行版；hermesc shim；release cleartext patch；连接改用模拟器 NAT 10.0.2.2 + 双 relay（adb reverse 数据断裂弃用）。
- 详见 `apps/android/docs/m0-report.md`。M1 起按 §8 继续：ui-auth → ui-feed → 用户主页。

---

## 附：首轮实现建议（评审通过后的第一动作）

1. 复制 android-face 到 `apps/android`，改名工作区，跑通空壳 debug 包；
2. 建 `apiClient` + `router` 两个纯逻辑包并写 vitest（A1/A2 先行）；
3. 做 ui-auth + ui-feed 两张 face 的 MVP，模拟器截图与 Web 对照；
4. 剩余功能按 F3–F10 逐个插件行补齐，最后收热更新闭环。