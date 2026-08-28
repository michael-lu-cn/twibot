# 调研报告：用 Cordis 架构插件化重构 Twitter 项目

> 生成日期：2026-08-28 ｜ 范围：只读调研，不落地代码
> 参考对象：
> - 现项目：`projects/twitter`（Hono + better-sqlite3/Drizzle + Playwright + React 19 + shadcn/ui）
> - 架构蓝本：`projects/cordis` 下全部调研文档（deepseek-harness / dsh 插件机制、多入口可生长应用架构、系统树架构、Cordis×RN Android 落地报告与可行性评估/计划 2.0、android-face 实测）
> - 新项目种子：`projects/twibot`（"增强 twitter 客户端"，本报告将落于此项目 docs/）

---

## 0. 结论先行

1. **值得重搞，且方向明确**：现有 twitter 项目功能完整但形态是"单体"——入口硬编码路由、服务模块顶层互相 import、前端路由/侧边栏固定。Cordis 架构（无特权内核 + 插件树 + 配置层叠）让它变成"一个薄壳 + 一棵可装配、可装卸、可热更的插件树"。
2. **"一切插件化"在本项目的落地面**：API 侧（存储/限流/凭据/浏览器会话/GraphQL/页面解析/各抓取器/群组领域服务/路由注册）与 Web 侧（应用壳/各视图/推文卡片/评论面板/导航槽位）全部可以映射为插件或服务，且**大部分是"搬模块 + 改接线"而非重写**（参照 android-face P0 实测：Cordis 内核是纯 TS，跨运行时零改动）。
3. **分阶段是正解**：P0 微内核壳 + 服务化（行为不变）→ P1 功能插件化 + 配置装配 → P2 Web 双树化（静态 roster）→ P3 多入口（web / headless 定时同步 / api-only）→ P4 动态生长（HMR / 动态 chunk / 插件热装卸，未来可接 agent 自改）。
4. **主要风险不在框架**，而在 X 抓取的脆弱性（页面结构/hash 变化）——这恰恰是插件化的收益点：把"解析器"做成可替换 seam，坏一个换一个，不必改整个应用。
5. **Web 端架构已深化（收到新研究后补充）**：web 端不搞"单树 + 组件注册"的简化版，而是照抄 dsh web 的**浏览器第二棵 Cordis 树**（对象层/渲染机制/呈现组件三层 + slot 单一 API + 静态 roster → 动态 chunk 两阶段）。由此 `CommentsProvider`（React Context）与 `openTabs` 的竞态补丁可整体删除——React 只做投影，状态全在 React-free store。详见 §3.4、§3.5。

---

## 1. 现项目盘点：twitter（12-00-version）

### 1.1 技术栈与进程

| 端 | 技术 | 端口 |
|---|---|---|
| API | Node(tsx) + Hono + better-sqlite3 + Drizzle + Playwright(curl 直调 GraphQL) | 12000 |
| Web | React 19 + Tailwind v4 + shadcn/ui + react-router-dom v7 + lucide | 12001（vite proxy → /api） |

工作方式：**本地优先 + 手动增量同步**。GET 只读 SQLite（未同步 404 `NOT_SYNCED`），POST `/sync` 才抓 X，按 X id upsert 去重返回 `added`。

### 1.2 数据表（8 张，均按 X id 主键）

`users` / `tweets` / `comments` / `following_rels` / `bookmarks` / `groups` / `group_members` / `app_kv`。

核心排序机制：**position 时间轴**（越大越新，首次锚定 100000、过去递减、未来递增、整条流可重编号）——`db/position.ts` 是纯函数库，天然可独立成插件资产。

### 1.3 API 结构（api/src）

```
index.ts                # Hono 入口：initDb → 装配路由 → serve；含 /hello /health /shutdown
db/
  db.ts                 # better-sqlite3 + drizzle 初始化、幂等建表 + position 迁移
  schema.ts             # drizzle schema（8 表）
  repo.ts               # 全部读写操作（upsert/查询/群组/书签/kv）——661 行
  position.ts           # position 时间轴规划算法（纯函数）
twitter/
  routes.ts             # 全部 20+ 端点（读库 + sync + 搜索 + 群组 + 监控）——341 行
  types.ts              # Tweet/FollowingUser/ApiError/ErrorCodes/Ok-Err 信封
  ratelimit.ts          # 令牌桶(graphql 8@15/min) + 页面桶(12s) + 互斥锁 + 5min 缓存 + _stats
  browser.ts            # cookie 源解析(env/cUrl/cookies.txt) + CDP + Playwright 会话 + 锁
  graphql.ts            # curl 直调 X GraphQL（operation hash 表 + 429 退避）
  page-scripts.mjs      # 页面内 evaluate 纯函数（extractProfile/DomTweet/Cell/CurrentUser...）
  tweets.ts             # 拦截 UserTweets 响应抓推文 + DOM fallback + 滚动翻页 + 落库
  following.ts          # 智能策略(小列表页面抓 / 大列表 GraphQL 翻页 / 兜底) + handle→userId 24h 缓存
  comments.ts           # 拦截 TweetDetail 抓评论树（嵌套 items 解析）
  search.ts             # 结构化条件→X 语法→拦截 SearchTimeline（实时不落库）
  me.ts                 # 当前账号解析(书签页 DOM 首发现) + 资料/关注/书签同步
  groups.ts             # 群组业务：handle→userId 本地优先 GraphQL 兜底
```

### 1.4 前端结构（web/src）

外壳 `App.tsx`：路由表（`/` 浏览、`/me`、`/users` 多标签、`/groups`、`/search`）+ Sidebar + CommentsProvider 全局上下文 + 右侧评论面板。`UserTabsView` 是"浏览器式多标签"（localStorage 持久化 + 全部标签保持挂载缓存状态）。

### 1.5 单体病灶（插件化要解决的痛点）

| # | 病灶 | 表现 | 插件化后的形态 |
|---|---|---|---|
| 1 | **入口即装配** | `index.ts` 固定 initDb + 固定 mount `twitterRoutes` | 入口薄壳：读一棵 cordis.yml/patch 树，树里声明每个插件 |
| 2 | **服务即模块级单例** | 限流桶、页面锁、缓存、userIdCache、cachedHandle 全部是模块顶层 `let/const`，互相顶层 import | 变成 `ctx.*` 服务：`ctx.credential` / `ctx.session` / `ctx.ratelimit` / `ctx.store`，inject 声明依赖，卸载自动回收 |
| 3 | **路由集中注册** | 341 行 routes.ts 一个文件承载 20+ 端点，"静态群组路由必须在动态 `/:username` 之前"靠人肉纪律 | 每个功能插件自注册自己的 Hono 子路由；插件卸载 = 路由移除，无需关心全局顺序（或由 api 插件按树顺序装配） |
| 4 | **抓取类型耦合** | tweets/following/comments/search/me 各自直接 `launchSession()` + `page.on("response")` 复制粘贴拦截解析 | 共享 `ctx.session`（浏览器会话）+ `ctx.pageParser`（拦截/解析器），各抓取器只写"我要什么数据" |
| 5 | **解析器硬编码** | `page-scripts.mjs` 与 X DOM/GraphQL 结构强绑定，改版即崩（README 已知限制） | 解析器做成 seam 的 provider：`page-parser-x-v1` / `graphql-parser-x-v1`，可 patch 替换/叠加，坏一个换一个 |
| 6 | **凭据/配置散落** | cookie 来源、`TWITTER_CDP_URL`、限流参数全是环境变量 + 硬编码常量 | 做成 `ctx.settings`/`ctx.credential` 服务 + 配置项可 patch；账号切换 = 改配置行 |
| 7 | **前端整体性** | 路由表、Sidebar、评论面板在 App.tsx 写死；新增视图必须改外壳 | Web 侧双树 slot 化（`app.main` / `app.nav` / `app.panel`，详见 §3.4）：每个视图/面板是一个插件注册进槽位；删一行配置 = 该 UI 消失 |
| 8 | **无运行时可观测** | 只有 `_stats` 限流监控 | `inspect` 服务（活插件/活服务/事件表），为未来 agent 自管理留插座 |

---

## 2. Cordis 架构理念（来自 projects/cordis 调研 + 官方资料）

Cordis 是 [Koishi](https://koishi.chat) 生态的插件框架（同名 npm 包），被 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）整体 vendored 作为运行底座，中文资料见 [Cordis Primer（中文）](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.zh.md) 与 [Service 文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/service.md)。Cordis 已在 Koishi 生态经受过上千插件并发的实战考验（[背景介绍](https://cloud.tencent.cn/developer/article/2728030)）。

一句话：**应用 = 无特权内核（context）× 组合（插件树）**。

### 2.1 四根支柱（运行层）

| 支柱 | 含义 | 在本项目中的对应 |
|---|---|---|
| **context 服务仓库** | `ctx.<key>` 查找服务；服务可 `provide(name, value)` 注册，也可被 `inject` 声明依赖 | `ctx.store` / `ctx.ratelimit` / `ctx.session` / `ctx.pageParser` |
| **inject 依赖收敛** | 插件声明需要哪些服务；依赖不齐则 INACTIVE，齐了自动激活，失效自动 unload 恢复后 reload | 评论同步插件 inject `['store','session','pageParser']`，依赖缺失时自动等待 |
| **四种事件派发** | `emit`（广播）/ `waterfall`（可改写/拒绝）/ `parallel` / `serial` | 同步完成事件 `tweet/synced`、预执行门 `sync/pre-execute`（可被限流插件短路） |
| **可逆 effect** | 插件 body 里每个注册（路由/监听/provider/定时器）都返回 disposer；卸载按逆序回滚，幂等 | 插件 unload = 路由移除 + 监听解绑 + 浏览器进程关闭 + 缓存注销 |

### 2.2 组合层（配置即应用实例）

- **cordis.yml**：顶层 YAML 数组，一行一个 entry（`{id, name, config, inject, disabled, group}`），`name` 是被动态 import 的模块。
- **patch 叠层**：`bundle patch → profile patch → home patch → --patch overlay`，按 **id 定位整行替换**（config 整行替换、无深合并），`insert:` 可插入新行——**产品形态 = 一次有序配置叠层**，而非二进制。
- **`--dump-config`**：离线打印将要启动的插件树，与真实启动零偏差（同一算法），打印出的任何行都能被上层 patch 替换。
- **HMR**：patch 文件保存即触发整棵树事务性重组；失败保持最后的好树并广播错误——**改配置就是部署**。

### 2.3 多入口与自生长

入口都是"选配置 + 调 boot"的薄壳，共享同一服务词汇表与同一个 session 日志；`inspect/define/run/stop/undefine` 让应用自省、在内存里试验、经评审固化为正式插件（三级生长闭环）。

### 2.4 领域内的实践证言（android-face 实测，2026-08）

Cordis 内核为纯 TS（约 2700 行，零 Node API/DOM/eval/动态 import），可运行在任意 JS 环境。android-face 已按 Cordis 模式把 RN App 做成"壳 + 插件树"，多轮实测结论：

- **P0–P2 全过**：内核激活/disposer 逆序、priority slot（18/18）、连真宿主收真模型回复、**删一行 roster 配置对应 UI 消失**、远端 chunk 按 `url@rev` 拉取→求值→注册→热挂载（rev 变则失效重拉，冷启动持久化命中跳过网络）——"改配置即部署"在移动端被实证。
- **关键范式**：**状态放宿主/服务端，客户端只做投影渲染** → 插件更新走 bundle 热更，`new Function` 不再是硬前提（Hermes 即可），JSC 从"战略必需品"降级为"可选优化"。
- **机制红利（可直接抄）**：inject 依赖缺失时 fiber 保持 PENDING、服务出现自动激活（装配器免拓扑排序）；卸载按逆序级联回滚；未知模块名/重复 id/二次挂载全部 loud-fail；差分装配器"启动装满、此后增删行增量装卸"。
- **工程形态（可直接抄）**：`roster.ts` 行清单（`{id,module,config,remote?{url,rev}}`）+ `modules.ts` 模块表（每次安装产出新插件对象）+ `script-loader.ts`（`url@rev` 内存缓存 → AsyncStorage 持久化）+ `slot-core.ts`（priority 遮蔽）。
- **最痛的教训**：测试用的 Mock 必须按真 wire 抓包形态建模，否则"自己和自己一致"而真环境全错；动态通道的 guard/权限面要前置到 P3 之前想清楚。

---

## 3. 概念映射：现 twitter 功能 → Cordis 插件树

> 原则（照搬 dsh 铁律）：注册皆 effect；一事实一 home；可替换的做成 seam（Definition/Provider/Consumer 三角色）；组合根可 dump。

### 3.1 内核（不可再拆的最小集）

| 能力 | 说明 |
|---|---|
| Context | 服务 key 注册 + inject 解析 + 四事件派发 + effect/disposer |
| boot 序列 | 环境加载 → 配置合成（entry 树）→ mount → 断言全部 entry 激活（fail loud） |
| 入口薄壳 | `twibot api` / `twibot web` / `twibot sync` —— 三合一进程即可，各自只是"选哪棵树" |

### 3.2 服务层插件（Definition / Provider / Consumer）

| 服务 key | Definition（接口） | Provider（可替换实现） | Consumer 举例 |
|---|---|---|---|
| `ctx.store` | 表读写 + position 规划接口 | `store-sqlite`（现有 db.ts/repo.ts/schema.ts/position.ts 平移） | 所有同步器 |
| `ctx.credential` | 登录态解析接口 | `credential-curl-file`（现有 browser.ts 的 cookie 解析三链） | session / graphql |
| `ctx.session` | 启动页会话语义（launch/close/锁） | `session-playwright`（现有 launchSession + 12s 串行锁）；可另出 `session-cdp` | 各抓取器 |
| `ctx.graphql` | 直调 X GraphQL（限流+退避+hash 表） | `graphql-curl`（现有 graphql.ts） | following/bookmarks/me |
| `ctx.ratelimit` | 桶/锁/缓存/统计 | `ratelimit-token-bucket`（现有 ratelimit.ts 平移） | session/graphql |
| `ctx.pageParser` | 页面拦截与 DOM 解析接口 | `parser-x-dom-v1`（现有 page-scripts.mjs + 各文件内拦截逻辑收敛） | tweets/comments/search 同步器 |
| `ctx.currentUser` | 当前登录账号解析接口 | `current-user-kv+bookmarks`（现有 me.ts 的 resolveCurrentHandle） | me 视图 |
| `ctx.userIds` | handle→userId 解析接口（24h 缓存） | `userids-cached-graphql`（现有 following.ts 的 resolveUserId） | groups / following |

### 3.3 功能插件（每个 = 一组 entry）

| 插件 | 职责 | 装载形态 | 卸载回滚什么 |
|---|---|---|---|
| `api-server` | 起 Hono，挂 `ctx.api` 服务，把各功能插件注册的路由按树顺序装配 | 组插件 | 进程退出/restart |
| `sync-tweets` | POST sync 抓用户推文（拦截 UserTweets）+ 落库 | 注册路由 + 监听 `sync/pre-execute` | 路由 + 监听 |
| `sync-following` | 智能策略抓关注（页面/GraphQL 兜底）+ 落库 | 同上 | 同上 |
| `sync-comments` | TweetDetail 拦截抓评论树 + 落库 | 同上 | 同上 |
| `live-search` | 实时搜索（不落库）+ 5min 缓存 | 注册 GET 路由 | 路由 |
| `domain-groups` | 群组领域服务（依赖 ctx.store + ctx.userIds） | provide `ctx.groups` + 注册路由 | 服务 + 路由 |
| `domain-me` | 我的资料/关注/书签（依赖 ctx.currentUser） | provide `ctx.me` + 注册路由 | 服务 + 路由 |
| `stats-monitor` | `_stats` 监控端点（读 ctx.ratelimit） | 注册 GET 路由 | 路由 |

### 3.4 Web 侧架构深化：浏览器第二棵 Cordis 树（参考 dsh web 客户端）

> 依据：[deepseek-harness-web客户端研读报告.md](../cordis/deepseek-harness-web客户端研读报告.md)（packages/client 全部 40 包 + apps/web 启动链 + 宿主传输五分工，已通读）

**关键认知（与 android-face 同源）**：dsh 的浏览器端不是静态资源，而是与宿主**同一个 vendored Loader 治理**的第二棵 cordis 客户端树（约 35 个 ui-* 插件 + runtime/connection/modules/hmr/shell）。android-face 正是把这棵浏览器树移植到 RN；**twitter 的 Web 端可以直接照抄这棵树**——两端同为浏览器/React 环境，连模块加载机制都不用换。

三条总纲（照搬 dsh web）：

1. **React 只是投影**：业务状态全在 React-free 对象层（zustand vanilla + immer，裸 observable），组件经 `useSyncExternalStore` 订阅不可变快照，零 ctx、零框架 import；
2. **slot 单一 API**：`ctx.slots.register({name, children, store, inject}, Component)` —— children 同时是"存在声明"与"渲染授权"，四份 props 全自动派生；渲染未声明槽/重复声明都在 load 时响亮失败；
3. **组合即配置**：浏览器名册就是一行行 roster/yml 条目，disable 即下架；删一行 = 对应 UI 消失，无需改壳。

#### 3.4.1 三层结构（对象层 / 渲染机制 / 呈现组件）

| 层 | dsh web 对应 | twitter Web 对应 |
|---|---|---|
| **对象层**（React-free） | `runtime/`（SessionManager/Snapshot/defineStore，9032 行零 React import） | `store/`：openTabs（localStorage 持久化）、comments 选择（**替代现有 React Context**）、用户/推文本地缓存；`webapi/`：fetch 封装（`Ok/Err` + `ERROR_HINTS` 统一走这里） |
| **渲染机制** | `ui-renderer`（slot outlet + uSES 绑定 + root mount） | `web-shell/ui-renderer`（SlotOutlet + `useStore` 绑定 + `mount(#root)`），约百行级 |
| **呈现组件** | 35 个 ui-* 包，纯 props，可整体重写 | 现有 16 个组件按职责拆成 ui-* 插件，组件零 ctx，全部数据经 props shares 到达 |

直接收益：现有 `CommentsProvider`（React Context）可整体删除——comments 选择状态进对象层 store；`openTabs` 也进 store，URL `?u=` 由 `ctx.router` 服务同步，顺带消掉现有代码里专门为竞态写的 `closingRef` 逻辑。

#### 3.4.2 槽位规划（命名法 `<domain>.<entry>.<hole>`，dsh 实测热点槽即此格式）

| 槽位 | kind | 注册者 | 说明 |
|---|---|---|---|
| `app.main` | single | 各视图插件（按 route 匹配） | 等价 dsh `'root'`；web-shell 按 `ctx.router` 当前路由渲染胜出者 |
| `app.nav` | list（order 排序） | 各视图插件的导航入口 | 侧边栏项按 order 排序 |
| `app.panel` | keyed | CommentsPanel | 全局右面板；将来加"同步日志"面板 = 加一个 key |
| `user.profile.actions` | keyed | 群组徽章/HoverCard、加入群组弹层 | 用户详情资料卡扩展 |
| `user.profile.sections` | keyed | 推文 Tab / 关注 Tab | UserTab 内分区 |
| `tweet.actions` | chain（条目自荐） | （未来）翻译/收藏/分享按钮 | 新扩展零 owner 改动 |
| `global.state` | single | store 组合根（openTabs/comments） | 若 store 拆包，由组合插件统一装配 |

#### 3.4.3 Web 启动链（参考 dsh `AppWebEntry.run()`）

```
index.html（+ 内联 loader 垫片）
 → boot()：new Context() → 建 slots（createSlotCore）
 → ctx.plugin(Loader, { internal: modules })      ← 唯一接缝（loader.internal 一个赋值点）
 → 取名册（boot 图谱 / 静态 defaultRoster）→ prefetch immediately 行
 → 逐行 loader.create({name}) → await → assertEntriesActive()
     （import 失败/FAILED/PENDING 列出缺失服务名，聚合抛错 = fail loud，无部分可用模式）
 → mountApp()：ctx.inject(['uiRenderer'], scope => scope.uiRenderer.mount(#root))
     一次成型替换为真 UI；换 uiRenderer = 整应用重挂
```

#### 3.4.4 模块加载两阶段

| 阶段 | 机制 | 来源 |
|---|---|---|
| **P2 静态 roster** | vite 直接打包全部 ui 插件；roster = TS 静态数组（类比 dsh `PLATFORM_MODULES` 种子表 + `defaultRoster`）；惰性工厂表 `__TWIBOT_MODULES__.load({id, factory})`，副作用（含 CSS 注入）延迟到首次 require 物化并 memoize | 构建期，vite graph 内 |
| **P4 动态 chunk** | 宿主 `modules` 服务对位：扫各功能包声明的 client 入口 → 组图 `{rev}` → 服务 `/plugins/<id>/client.js?rev=` + 清单 API；浏览器按 `url@rev` 缓存拉取 → 注册工厂 → rev 变则失效重拉 → `entry.refresh()`（先删旧 disposers 再物化） | 宿主下发（dsh `/plugins/` + `__DSH_BOOT__` 同款） |

静态先行的理由（与 android-face P1 结论一致）：cordis fiber 依赖等待内建（PENDING 自动激活），装配器免拓扑排序；静态阶段先把"删一行 roster 对应 UI 消失"跑通，动态只是把 roster 来源从本地数组换成宿主 API——**装配器与插件零变化**。

#### 3.4.5 Web 侧服务词汇表

`ctx.slots` / `ctx.loader` / `ctx.webApi`（fetch + `Ok/Err`）/ `ctx.store`（openTabs、comments、本地缓存）/ `ctx.router`（包装 react-router：读 `?u=`、导航、当前路由；保留 react-router 底层，因为 URL 语义是现有核心体验）/ `ctx.theme`（可选，主题令牌）。

#### 3.4.6 与 dsh web 的差异点（twitter 不需要照搬的部分）

- 无会话流/事件推送：不需要 ConnectionController/双 WS/SessionManager/ConversationAssembler（对象层从"事件窗口重放"退化为"请求-响应 + 手动刷新"）；
- 无模型可见面：不需要 systemPrompt section / 工具 schema 汇编，呈现组件只服务人；
- HMR 走 vite dev 即可，P4 的动态插件 rev 失效逻辑才需要 `invalidate → registry.delete → refresh` 链。

### 3.5 抓取能力缝（参考 dsh web 能力 seam 的三角色 + 执行时选择）

> 依据：[deepseek-harness-web能力研读报告.md](../cordis/deepseek-harness-web能力研读报告.md)（`ctx.web` 接缝：Definition/Provider×4/Consumer 三角色 + resolveProvider 选择规则）

本项目最大的长期维护面是"抓到 X 的数据"，正好按 dsh web capability seam 的纪律收敛：

| 角色 | 包 | 职责 | 明确不做 |
|---|---|---|---|
| **Service Definition** | `ctx.session` / `ctx.pageParser` | 注册表（fetch 通道 / 解析器）+ 执行时 provider 选择 + 统一错误类型 | 不做任何 X 网络请求、不认识具体 provider |
| **Service Provider** | `session-playwright` / `session-cdp`；`parser-graphql-intercept` / `parser-dom-fallback`；`graphql-curl` | 各自的通道/解析实现，响应映射到归一化类型 | 不碰路由/落库/错误文案；provider 之间互不 import |
| **Consumer** | sync-tweets / sync-following / sync-comments / live-search | 只调 `ctx.session`/`ctx.pageParser` 要数据，落库与返回 | 不知道任何 provider 存在 |

**执行时选择规则（照抄 dsh `resolveProvider`，与注册顺序无关）**：

| 场景 | 结果 |
|---|---|
| 配置了 id，已注册且可用 | 用它（例：`config.pageParser: graphql-intercept`） |
| 配置了 id，未注册 / 不可用 | 抛 `PARSER_CONFIGURED_MISSING` / `_UNAVAILABLE`（fail loud） |
| 未配置，恰好一个可用 | 自动选中 |
| 未配置，多个可用 | 抛 `PARSER_AMBIGUOUS`（列出候选，要求显式配置） |
| 未配置，零个可用 | 抛 `PARSER_UNAVAILABLE` |

配套纪律（照抄）：**layered truncation**——provider 层截断（如每条推文/每页条数）→ 接缝层 maxResults 截断 → consumer 层输出封顶，层层置位；**启用 ≠ 可用**——配置了但 provider 缺失时工具仍可见，执行时才报结构化错误（避免 UI 随环境抖动）；**诚实缺口**——X 结构变化导致的解析失败作为已知限制进文档，由 fallback provider 兜底而非藏起来。

---

## 4. 装配蓝图（一份 cordis.yml 长什么样）

```yaml
# twibot/cordis.yml —— 产品组合（示意）
- id: core-store
  name: '@twibot/store-sqlite'
- id: core-credential
  name: '@twibot/credential-curl-file'
- id: core-session
  name: '@twibot/session-playwright'
  inject: [core-credential, core-ratelimit]
- id: core-graphql
  name: '@twibot/graphql-curl'
  inject: [core-credential, core-ratelimit]
- id: core-ratelimit
  name: '@twibot/ratelimit-token-bucket'

- id: sync-tweets
  name: '@twibot/sync-tweets'
  inject: [core-store, core-session, core-page-parser]
- id: sync-following
  name: '@twibot/sync-following'
  inject: [core-store, core-session, core-graphql, core-userids]
- id: sync-comments
  name: '@twibot/sync-comments'
  inject: [core-store, core-session, core-page-parser]
- id: live-search
  name: '@twibot/live-search'
  inject: [core-session, core-page-parser]
- id: domain-groups
  name: '@twibot/domain-groups'
  inject: [core-store, core-userids]
- id: domain-me
  name: '@twibot/domain-me'
  inject: [core-store, core-session, core-graphql, sync-following]

- id: api-server
  name: '@twibot/api-server'
  inject: [sync-tweets, sync-following, sync-comments, live-search, domain-groups, domain-me]

- id: web-runtime                       # 参考 dsh web-app bundle：FrontendStatic + ctx.modules + /plugins/* + boot 注入
  name: '@twibot/web-runtime'
  inject: [api-server]

# ── 浏览器名册是【另一棵树】（web/roster.ts 静态，或由 web-runtime 经清单 API 下发）──
# web/roster.ts（示意，构建期静态；P4 后来源换成宿主清单）
[
  { id: 'web-shell',     module: '@twibot/web-shell' },      # slots + ui-renderer + router + webApi + store
  { id: 'ui-nav',        module: '@twibot/ui-nav' },         # → app.nav
  { id: 'ui-browse',     module: '@twibot/ui-browse' },      # → app.main (route:/)
  { id: 'ui-me',         module: '@twibot/ui-me' },          # → app.main (route:/me)
  { id: 'ui-users',      module: '@twibot/ui-users' },       # → app.main (route:/users)，多标签容器
  { id: 'ui-groups',     module: '@twibot/ui-groups' },      # → app.main (route:/groups)
  { id: 'ui-search',     module: '@twibot/ui-search' },      # → app.main (route:/search)
  { id: 'ui-comments',   module: '@twibot/ui-comments' },    # → app.panel
  { id: 'ui-user-actions', module: '@twibot/ui-user-actions' }, # → user.profile.actions（群组）
]
```

要点：
- **删一行 = 少一个能力**（如 `disabled: true` 的 `live-search`，搜索 UI 与路由同时消失；浏览器名册删 `ui-groups` 行 = /groups 视图消失）；
- **换 provider = 换一行的 name**（如 `core-session` 换成 `session-cdp`、`parser-graphql-intercept` 换成 `parser-dom-fallback`，全树行为切换，业务插件零改动）；
- **加功能 = insert 一组行**（如"书签分类" = `domain-bookmark-folders` + `ui-bookmark-folders` 两行，分属两棵树）；
- **两棵树共享服务词汇表**（`ctx.store` 的语义、webApi 契约、错误码），中间只有 HTTP 线协议——与 android-face 双树原则同构；
- `--dump-config` 可离线自检宿主树；浏览器树另有 `roster.dump()` 等价物。

---

## 5. 迁移路线（分五期，每期可独立验收）

### P0：微内核壳 + 服务化（行为零变化）· 约 3–5 天

- 新建 `twibot/`（pnpm monorepo：`packages/core`（内核/服务定义）、`packages/plugins/*`、`apps/api|web|cli`）；
- 引入 cordis（npm 官方包或 vendored dsh 副本，见 §7 待定决策）；
- 把 `db/`、`ratelimit.ts`、`browser.ts` 的会话/凭据、`graphql.ts` 平移为 `ctx.store / ctx.ratelimit / ctx.session / ctx.credential / ctx.graphql` 服务；`routes.ts` 暂保持不动，由 `api-server` 插件挂载；
- **验收：`pnpm dev` 启动后，现有 Web 全部功能可用，`_stats` 照常；`--dump-config` 打印的树与真实行为一致。**

### P1：功能插件化 + 配置装配 · 约 1–2 周

- 拆 `sync-tweets / sync-following / sync-comments / live-search / domain-groups / domain-me / stats-monitor` 各成插件包，各自注册子路由 + provide 服务；
- 页面拦截/解析收敛成 `ctx.pageParser`（新建接口，先由 page-scripts.mjs + 各文件内的拦截代码合入一个 provider）；
- **验收：cordis.yml 每删一行（如 sync-comments），对应 API 端点 404、功能 UI 同步消失；换 `session-cdp` provider 后全站仍可用。**

### P2：Web 双树化（静态 roster 起步）· 约 2–3 周

- 按 §3.4/§3.4.4 落地浏览器第二棵树：`web-shell`（boot / slots / ui-renderer / router / webApi / store 服务）+ 现有 16 个组件按职责拆成 ui-* 插件 + 静态 `roster.ts`；
- `CommentsProvider` 与 `openTabs` 迁入对象层 store（React Context 与 closingRef 竞态逻辑随之删除）；
- 维持"多标签保持挂载"的渲染策略（display 切换逻辑不因插件化改变）；
- **验收：roster 删一行（如 ui-groups）→ /groups 路由 404、导航项消失、无脚本报错；fail loud：故意断一个插件 import → 整页停在错误态（列出缺失服务名），而非半可用。**

### P3：多入口 · 约 3–5 天

- `twibot sync` 无头入口：`--profile headless`，一条命令批量增量同步（关注/推文/评论/书签），复用同一棵树；
- 可选 `--dump-config`、`twibot inspect`（列出活插件/服务/事件）；
- **验收：两个入口共享同一内核与同一数据库，行为一致（双树同钟）。**

### P4：动态生长（远期）· 视需要

- HMR：patch 文件保存即热重组；
- **浏览器树接动态 chunk**：web-runtime 提供 `/plugins/<id>/client.js?rev=` + 清单 API，浏览器按 `url@rev` 缓存拉取、rev 变则失效重拉、`entry.refresh()` 热换——roster 来源从静态数组换成宿主 API，装配器与插件零变化（§3.4.4）；
- 运行动态 roster，模型/开发者经接口增删插件；
- **验收：不重启，改配置文件即部署；agent 能在会话中 inspect + 试验 + 固化插件。**

---

## 6. 风险与对策

| # | 风险 | 等级 | 对策 |
|---|---|---|---|
| R1 | **X 抓取脆弱**：DOM/GraphQL hash/结构改版即崩（现 README 已知限制） | 高·持续 | 把解析器收敛为 `ctx.pageParser` seam，GraphQL 失败自动回退页面抓取（现有策略保留）；坏一个 provider 换一个，patch 一层修一层，不动应用本体 |
| R2 | **插件化过度设计**：小项目硬上微内核增加认知成本 | 中 | 内核保持极薄（不内置任何业务）；只把"经常变/要开关/要换实现"的部分插件化；cordis.yml 即文档 |
| R3 | **UI 粒度失控**：slot 无限细分导致碎片化 | 中 | 槽位白名单（app.main / app.nav / app.panel / user.profile.actions / user.profile.sections / tweet.actions 起步，见 §3.4.2），新增槽位需评审；priority 冲突抛错兜底 |
| R4 | **全局单例迁移遗漏**：userIdCache/cachedHandle/pageLock 等模块级状态漏迁 | 中 | P0 阶段逐文件盘点（§1.5-2 表格即清单），服务化后用 inject 强制依赖可见 |
| R5 | **热更/动态加载的复杂度**（P4） | 低 | 分阶段：P2 先静态 roster，P4 才上运行时注入；android-face 证言"状态在宿主、客户端投影"可参考 |
| R6 | **路由顺序坑复发**：`/groups` 静态 vs `/:username` 动态（README 踩坑） | 低 | api-server 插件按树顺序 + 显式 group/priority 装配；Hono 可挂载子应用避免单文件顺序问题 |

---

## 7. 立项建议与待定决策

### 7.1 建议（默认推荐项）

1. **项目组织**：`twibot/` 起 pnpm monorepo——`packages/core`（Cordis 内核 + 服务定义 `ctx.*` 类型）、`packages/plugins/*`（每功能一包）、`apps/api`（api-server 入口）、`apps/web`（web-shell 入口）、`apps/cli`（sync/inspect 无头入口）。参照 android-face 的 `packages/{cordis-kernel,protocol-client,priority-slot}` 拆分。
2. **内核来源**（倾向 vendored dsh 副本）：与既有调研文档语义完全对齐（fiber/inject/effect/HMR），且含本地加固修复；备选 npm 官方 `cordis`（Koishi 生态，插件/文档丰富）——见 D1。
3. **首笔投入 = P0**：只做"服务化 + 壳化"，不改任何行为。用现有 Web 全功能回归做验收，风险最低、收益立刻可见（之后每个能力都是一行配置）。
4. **前端先静态 roster**：P2 用构建期静态注册 + 可开关（避免一上来就上动态加载的复杂度）；P4 再考虑远程 chunk。
5. **解析器 seam 优先**：`ctx.pageParser` 是 X 改版时唯一要动的点，P0 就要把页面拦截/解析代码收口（它是本项目最大的长期维护面）。

### 7.2 待用户拍板的决策

| # | 决策点 | 选项 | 我的倾向 |
|---|---|---|---|
| D1 | 内核用官方 cordis 还是 dsh vendored 副本 | A 官方 npm `cordis`；B vendored dsh | **B**：语义与现有调研文档完全对齐，含本地加固 |
| D2 | 重构范围 | A 仅 API 服务化 + 插件化，Web 保持现状；B API + Web 全插件化（本报告蓝图）；C 顺带重写 Web 视觉 | **B**（C 不是本次重点） |
| D3 | 与旧 twitter 项目关系 | A 新项目 twibot 从零搭壳、逐步迁移逻辑；B 在 twitter 项目内原地改造 | **A**（旧项目留作回归对照） |
| D4 | Web 插件化的深度 | A 静态 roster 起步（可开关、可替换）；B 直接上动态 chunk（android-face/dsh web P2 路线） | **A 起步**；web-runtime 的 `/plugins` 清单服务可提前就位（零风险），动态装载留 P4 |
| D5 | 是否保留"多标签保持挂载/状态缓存"特性 | 必须保留（现有用户体验核心） | 保留，slot 渲染不影响 display 切换策略 |
| D6 | 首个里程碑验收标准 | A P0 行为零变化回归通过；B P0 + P1（删一行配置少一个能力） | **B** 更有说服力，预算再加 1–2 周 |

---

## 8. 参考来源

**本地（projects/cordis 调研系列）**
- `deepseek-harness-插件机制研究.md`（Cordis 运行层/加载层/组合层机制）
- `deepseek-harness-研读笔记.md`（架构全景）
- `deepseek-harness-web客户端研读报告.md`（浏览器第二棵树：boot/modules/loader/ui-* /slots/renderer/HMR——本文 §3.4 依据）
- `deepseek-harness-web能力研读报告.md`（能力缝三角色 + resolveProvider 选择规则——本文 §3.5 依据）
- `dsh插件结构可视化.md`（总览图/组合机制/能力缝/双半结构）
- `多入口可生长应用架构研究.md`（微内核 + 配置层叠 + 多入口 + 自生长五件套）
- `系统树-单角色系统组合架构.md` / `系统树架构移动端落地报告.md`（角色系统分层组合）
- `cordis-react-native-android-插件化开发报告.md` + `可行性评估.md` + `计划-2.0.md`（落地蓝图 + 勘误）
- `android-face/docs/`（P0/P0.5/P1/P2 实测报告 + README：roster/模块表/装配器/rev 缓存/热更新）

**外部**
- [DeepSeek Harness Cordis Primer（中文）](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.zh.md)：Cordis 概念入门
- [DeepSeek Harness Services 文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/service.md)：服务 Definition/Provider/Consumer
- [DeepSeek Harness Events 教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/04-events.md)：四类事件派发
- [Cordis：从开源 QQ 机器人内核到 DeepSeek Harness 平台底座](https://cloud.tencent.cn/developer/article/2728030)：Koishi 生态实战背景
- [为什么用 Cordis 做 AI Agent 运行时](https://blog.csdn.net/qhvssonic/article/details/163735444)：选型背景
- [@deepseek-ai/cordis（npm）](https://www.npmjs.com/package/@deepseek-ai/cordis) 与 Koishi 官方 cordis 包

---

## 附录 A：Web 组件资产清单（P2 插件化前盘点，供拆分参考）

| 组件 | 职责 | 依赖的 API | 插件化去向 |
|---|---|---|---|
| `main.tsx` | React 挂载 | — | 不变（壳入口） |
| `App.tsx` | 外壳：Sidebar + 路由 + CommentsProvider + 评论面板；持有 openTabs | — | 拆成 `web-shell`（slot 渲染器 + 路由容器）；openTabs 迁入对象层 `ctx.store` |
| `Sidebar` | 导航（URL 高亮） | — | 各视图插件向 `app.nav` 槽注册入口项 |
| `BrowseTab` | 浏览：用户名查推文+关注、手动同步 | GET/POST profile/tweets/following | `ui-browse` |
| `MeTab` | 我的：资料/关注/书签三块独立同步 | GET/POST me* | `ui-me` |
| `UserTabsView` | 多标签容器（openTabs 状态 + URL ?u= 驱动 + 保持挂载） | — | `ui-users`（openTabs 迁入 `ctx.store`，?u= 由 `ctx.router` 同步，删掉 closingRef 竞态） |
| `UserTab` | 用户详情：资料卡 + 推文/关注 Tabs + 群组徽章/弹层 | profile/tweets/following/groups* | `ui-users` 子部件或独立 `ui-user-profile` |
| `GroupsTab` | 群组页（创建/删除/成员） | groups* | `ui-groups` |
| `SearchTab` | 高级搜索表单 | GET search | `ui-search` |
| `TweetCard` | 推文卡片（点击开评论面板） | —（消费 store 的 comments 选择） | `ui-tweet-card`，向 `app.panel` 注册触发 |
| `UserLink` | 统一用户入口（→ /users?u=） | — | `ui-user-link` |
| `CommentsPanel` | 右侧评论面板（本地优先 + 同步） | GET/POST comments | `ui-comments` |
| `CommentsProvider` | 全局评论选择 Context | — | 删除：comments 选择迁入对象层 `ctx.store`（dsh 范式：React Context 整体被 store 取代） |
| `Field/ErrorBox` | 表单包装 / 错误提示 | — | `web-shell` 共享 UI 资产 |

> 数据请求模式统一为「本地读 GET（秒开）+ 手动 POST sync 抓取后回查」，响应走 `Ok/Err` + `ERROR_HINTS` 提示——这条约定在插件化后保持为 web-shell 提供的共享客户端资产（`ctx.webApi`），避免各视图插件各写一套 fetch。

---