# P2 报告 —— 远端 chunk 与清单契约(P2.1 + P2.2)

> 日期:2026-08-25
> 结论:**北极星的机制闭环已全部打通并验证**:客户端 = 带缓存的投影基座;
> 插件 = 数据行(可来自宿主 inventory);新代码 = 带 rev 的远端 chunk,
> 下载 → 求值 → 注册 → 热挂载;rev 变化即失效重拉。

## 清单来源:现状宿主的 __DSH_BOOT__(零宿主改动 ✓)

客户端不依赖任何宿主侧改动:宿主 index 页注入的 `__DSH_BOOT__` 全局本就携带每个
web 插件的 `{id, url(/plugins/<id>/client.js?rev=), rev}`。boot 时
`fetchInventoryViaBootPage()` 解析它 → composeRoster 记为远端 chunk 候补。
设备实证:logcat `[roster] 远端 chunk 候补 42 个`,随后连接/接管/历史恢复照常。

harness 仓库里另实现了 `pluginInventory.list` 携带 url/rev 的稳定 RPC 版本
(测试 5/5 + Agent Note 三件套,**未部署**)——作为将来的上游贡献:把 HTML 解析
升级为类型化契约,非本客户端的前置依赖。

## P2.2 客户端通道(android-face)

| 文件 | 职责 |
|---|---|
| `src/chunk-registry.ts` | `__face_plugins` 全局注册表 + `new Function` 求值求值面 |
| `src/script-loader.ts` | `ensureChunkLoaded(module,{url,rev})`:内存缓存(url@rev 键,rev 未变跳过下载)+ fetch + 求值 |
| `src/index.ts` | 装配器:`RosterEntry.remote` 存在时走 chunk 通道取挂载面,否则本地模块表;`ModuleEnv` 注入 React/ReactNative/slots |
| `apps/remote-chunk-demo/dist/demo-panel.client.js` | 手写 IIFE 演示 chunk(React.createElement,priority -1 遮蔽演示) |

### 技术决策:执行通道统一为 fetch + new Function

Repack 5.3 已把 ScriptManager 内部化(包导出面不再暴露),原生装载通道暂不可用;
Hermes 的 `new Function` 让设备与 Node 走**同一条已测路径**,且正呼应计划 2.0
形态 C 的 evaluator 思想(代码即数据)。安全注记:代码来自宿主信任域,guard 白名单属 P3。

## 验收证据

| 层 | 用例 | 结果 |
|---|---|---|
| Node | 求值+缓存(rev 未变不重复下载)、rev 失效重拉、违约 chunk 抛错、HTTP 404 抛错 | ✅ |
| Node | 装配器 × remote 行:装载→slot 胜出(displayName=DemoPanel)→卸载消失 | ✅ |
| 协议层 | listPlugins 形状透传 / 旧宿主报错(MockHost) | ✅ 6/6 |
| 设备 | demo chunk 由 Mac :8099 服务(AVD 经 `10.0.2.2` 直达,零隧道):rev r1 上屏 | ✅ |
| 设备 | 内容 v2 + rev r2 → 冷启动 → 新文本上屏(**失效闭环**) | ✅ |
| 设备 | 移除演示行 → 正常聊天恢复(`docs/p22-final.png`) | ✅ |

全量:shell 套件 22/22,typecheck 干净。

## 运维备注

- chunk 静态服务(Mac):`cd /tmp/p05-chunks && nohup python3 -m http.server 8099 --bind 0.0.0.0 &`
  (模拟器经 `http://10.0.2.2:8099/<file>` 访问;curl 记得 `--noproxy "*"`);
- Metro 挂掉用 `scripts/start-metro.sh` 一键拉起(本轮已实战);
- 复演设备验收:取消 `defaultRoster()` 里 demo-panel 行的注释即可。

## 移交后续

1. 宿主重启后:url/rev 字段上线,deferred 候补名单自动开始出现真实 dsh-client-* 行;
2. RN 插件 chunk 的正式构建管线(tsup/Rspack 输出 IIFE)+ AsyncStorage 持久化缓存;
3. guard 白名单(evaluator 的 ctx 动词收敛)——计划 2.0 形态 C 的安全面前置。
