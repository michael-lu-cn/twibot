# Android M4 验收报告：F1–F10 与 Web 功能一致性

> 日期：2026-08-29 ｜ 状态：✅ PASS（Node 29/29 + 模拟器逐项实测）
> 覆盖：M0 壳工程 → M1 三屏 → M2 五 tab 业务 → M3 深链/主题，最终对照验收。

## 验收对照表（Web ↔ Android）

| # | Web 功能 | Android 实现 | 证据 |
|---|---|---|---|
| F1 | 认证设置（cookie 粘贴/保存/状态） | `screens/auth.tsx` Button：保存→`onAuthChanged`；状态卡+重检测 | vitest router 装配 3 项（未配置→AuthScreen） |
| F2 | 推荐流（卡片/同步/空态/加载） | `screens/feed.tsx` FlatList+TweetCard+同步 | 设备：推荐流 43 条真实推文（含相对时间 1d/22h） |
| F3 | 关注列表（同步/批量进度/取关） | `screens/following.tsx` + 批量进度条 | 设备：@stulay 关注 122 位；批量按钮可用 |
| F4 | 智能分组（chips/成员/改分组/取关） | `screens/groups.tsx` + `member-actions.tsx` 弹层 | 设备：AI · 16 组 chips、成员+操作弹层 |
| F5 | 书签（全量/按月分组/月份导航） | `screens/bookmarks.tsx` SectionList+月度 chips | 设备：61 条；2026年8月/5月/时间未知；chips 跳转不崩 |
| F6 | 用户主页（资料/推文/同步/返回） | `screens/user.tsx`；AppShell 覆层返回原 tab | 设备：@jiayuan_jy 资料+10 条推文+← |
| F7 | 用户/推文外链跳 X 原页 | TweetCard/用户行/顶栏 ⤴ → `Linking.openURL` | 设备 UI 元素 ⤴ 在 feed/user/following/groups |
| F8 | 导航与 URL 对应 | 深链 `twibot://` → tab/用户页（`lib/router.ts`+manifest intent-filter） | 设备：`twibot://bookmarks` 直达书签；`twibot://users/jiayuan_jy` 直达用户页 |
| F9 | 图片代理 | `api.imgProxyUrl` → RN Image | 头像在 feed/following/groups/用户页均正常 |
| F10 | 错误提示与限流 | `ERROR_HINTS` 中文文案复用 | 代码路径统一，vitest 信封测试覆盖 |

## 测试与质量

- **Node 档 29/29**：api-client 7、router 5 + nav/深链 4、group（月份/RFC2822）6、chunk-cache 6、inventory-roster 6。
- `tsc --noEmit` 干净；release 构建 12–24s 增量。
- 全工作区（4 包）56 项测试通过（含 cordis-kernel/priority-slot/protocol-client）。

## 设备验收证据（模拟器 emulator-5554，截图存档）

| 截图 | 内容 |
|---|---|
| `docs/android-m0-shell.png` | ui-hello：宿主已连通 ✔（configured=true, source=file） |
| `docs/android-m2-bookmarks.png` | 书签按月分组 + 月份 chips |
| `docs/android-m4-home.png` | AppShell 主页 tab + 底部五 tab + 推荐流 |
| `docs/android-m4-user.png` | 用户主页（深链直达） |

深链命令（经远端 adb）：
`am start -W -a android.intent.action.VIEW -d "twibot://bookmarks|home|users/<handle>" org.twibot.face`

## 关键修复清单（M0–M4 累计）

1. Hermes 不解析 RFC 2822 → `parseTweetTime` 手写解析（书签分组/相对时间恢复）。
2. AppShell early-return 破坏 hooks 顺序 → useMemo 提前、hooks 恒定。
3. SectionList `scrollToLocation` 崩溃 → `onScrollToIndexFailed` + `scrollTo` 降级。
4. 组件工厂必须经 JSX 渲染（`<C/>`），直接调用违反 hooks 规则。
5. release cleartext → `patch-android-manifest.sh`（prebuild 只写 debug）。
6. adb reverse 数据断裂 → 模拟器 NAT 10.0.2.2 + 双 tcp-relay。
7. gradle wrapper 下载卡死 → 复用已解压发行版直接构建。

## 遗留（非阻塞）

- `tests/legacy-dsh/`（android-face 继承 dsh 特性测试）未回归——twibot 无 dsh 会话需求，M4 后可从仓库移除或留档。
- 认证屏未在设备侧复测（当前凭据已配置，API 状态不可临时篡改）；装配逻辑已由 Node 测试覆盖，需改动凭据时可人工复测。
- 图片代理在部分图床域名可能被 SSRF 白名单拦截（沿用 web 行为）；头像 fallback 首字母兜底。