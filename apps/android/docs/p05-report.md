# P0.5 最简对话客户端 —— 完成报告

> 日期:2026-08-25
> 结论:**P0.5 五个里程碑(A–E)全部通过。** 壳工程完成向"一切皆插件"的正式形态迁移,
> 设备档(远端 Mac 模拟器 emulator-5554)完成真实对话闭环、流式占位、杀进程重开历史恢复的验证。

## 与计划的关系

按 `docs/p05-plan.md` 执行。P0 的实验面板代码全部退役,`apps/shell` 现在的结构即计划的插件树:

```
Context (root)
├── dsh-connection   provide 'dsh'      卸载 = close()
├── session-store    inject ['dsh']     provide 'sessions'   zustand vanilla 投影
└── ui-chat          inject ['dsh','sessions']               slot 'main' 注册 ChatScreen
```

App.tsx 只剩三件事:选宿主 → `boot()` 装配 → 渲染 slot 'main' 胜出组件。
删任一插件 = 对应 UI/服务消失(`ctx.registry.delete`,单测覆盖级联回滚)。

## 里程碑结果

| 里程碑 | Node 档 | 设备档 | 证据 |
|---|---|---|---|
| A 服务层 | ✅ 9/9 | —(纯逻辑) | `ctx.sessions.send('hello')` 返回非空回复;乐观上屏顺序断言 |
| B UI 渲染 | — | ✅ | 冷启动 → 宿主选择页(公网域名/USB reverse/启动)→ 点启动 → ChatScreen 上屏 |
| C 对话闭环 | ✅ 真宿主测试 | ✅ | 模拟器发送 `hi`:用户气泡 → **●●● 流式占位**(已抓到实况)→ 回复落定;服务端 turn/end 落账 |
| D 样式打磨 | — | ✅ 结构层 | 全部样式出自 theme 令牌;暗色配色截图 `p05-shot-*.png`(像素级比对留待人工过目) |
| E 恢复测试 | ✅ MockHost | ✅ | force-stop → 重开 → 启动:`session.list` 接管最近非空会话,整页历史恢复(用户+助手气泡齐全) |

## 过程中发现并修复的真 bug

**wire 形态分歧导致恢复丢用户气泡(E 露馅)。**
真宿主 `user/message` 事件的 data 是平铺的 `{content, role, id, source}`;
MockHost 和恢复投影(`messageFromSessionEvent`)却都按 `{message:{content}}` 嵌套读——
Node 档测试因此全绿但设备档杀进程重开后**所有用户气泡消失**,只剩助手气泡。

修复(三处同 PR):
1. `protocol.ts`:`UserMessageData` 承认两种形态(平铺为准,嵌套兼容);
2. `sessions.ts`:按事件类型取 `data.content ?? data.message?.content`;
3. `mock-host.ts`:user 事件改为平铺形态,对齐真宿主。

教训入册:**MockHost 必须以抓包的真实 wire 形态为基准,而不是以"客户端恰好怎么读"为基准**——
否则测试只验证了"自己和自己一致"。

## 设备自动化经验(后续驱动脚本直接复用)

> 连接拓扑与域名的定稿事实以 README「连接拓扑」为唯一出处;本节只记过程坑,避免两处漂移。

1. **adb `input text` 在 Fabric 下不可靠**:字符进得了原生 EditText 但不触发 onChangeText,
   React draft 仍是空串,点发送被 early-return 吞掉。改用 `input keyevent <KEYCODE>` 逐键注入。
2. **隐形 IME surface 吃点击**:点过输入框后,Gboard 窗口可能以 `mHasSurface=true` 全屏存在
   (`dumpsys window windows` 可见),此后所有 `input tap` 都打在 IME 上。
   发送前先 `input keyevent 111`(ESC)收起 IME,并确认 InputMethod surface 消失再点坐标。
3. 远端驱动一律 `ssh host bash --noprofile --norc < script`,且**每条 adb 命令必须 `</dev/null`**,
   否则 adb 吞掉脚本剩余 stdin,表现为"只有第一条命令生效"。
4. 迭代链路:本机 Metro 不参与(release 包无 dev-support);改 JS 后
   `./gradlew assembleRelease`(增量 ~15s)→ scp 到 Mac → `adb install -r` → 重启 App 即得新包。
   注:P0 实验期(8/24 晚)实为 debug 包走 Metro(见 ui1.xml 报错弹窗与后续成功 dump),
   8/25 早 release 覆盖安装后断链;恢复方式见 README「连接拓扑」双包纪律。
5. 冷启动后 uiautomator dump 经常失败(输出为空):循环重试到出现 "dumped" 再 cat;
   BACK 键(keyevent 4)会直接退出 Activity——收起 IME 必须用 ESC(keyevent 111)。
6. 远端 Mac 的 SSH:加 `-F none`(系统 ssh_config 属主不对会拒连);登录 shell 是 fish 且
   starship 缺失刷屏,忽略 stderr 即可;Mac 侧 curl 默认走代理,探测要 `--noproxy "*"`。
7. 会话隔离的时序细节:App 接管的是 updatedAt 最新的非空会话。先给隔离测试会话发一条
   ping 顶到最新,再立刻重启 App,否则会再次接管真实工作会话(本次已发生过一回)。

## 会话隔离纪律

首轮 C 验证时,模拟器经 `session.list` 接管的"最近非空会话"恰是**当前开发工作会话本身**,
测试消息打进了真实工作上下文。已改为专用隔离通道:

- 测试会话:`session-3a3a18da-115f-459f-a87f-1eb27376829f`
- 绑定 workspace:`tmp-research/deepseek-harness/.p05-device-test/`(scratch 目录)
- 之后所有设备档对话(含种子 ping、hi 往返)均发生在该会话;主工作会话零新增。

后续设备测试沿用此纪律:先建隔离会话并保持其 updatedAt 最新,再重启 App。

## 遗留与移交 P1

| # | 项 | 说明 |
|---|---|---|
| 1 | 截图像素级主题比对 | `p05-shot-c.png`(对话闭环后)/ `p05-shot-e.png`(恢复后)已存,肉眼核对 dsh 暗色观感 |
| 2 | 历史 Markdown 直显 | 回复中的 markdown 源码原样上屏(P0.5 明确不做渲染,混合岛方案在 P1+ 评估) |
| 3 | roster 配置驱动 | P1 第一项:插件列表外置,删一行 = UI 消失 |
| 4 | 大 history 分页 | 当前 reload 取尾页 200 条封顶 |
| 5 | 临时驱动脚本清理 | `.p05-*.sh/.p05-*.xml` 为本次验证的一次性工具,报告落定后删除 |

## 复现路径(下次验证直接照抄)

```bash
# 出包(增量)
cd android-face/apps/shell/android && ./gradlew assembleRelease
# 部署(scp 到 Mac + 安装)
bash .p05-deploy.sh
# 验证:冷启动→启动→(可选 keyevent 打字→ESC→点➤)→dump/screencap 断言
```
