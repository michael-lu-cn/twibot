# P1 架构改造报告 —— roster 配置驱动 + 模块表

> 日期:2026-08-25
> 结论:**壳不再认识任何具体插件。** 插件清单是数据(roster),代码身份进模块表(factory),
> 装配器持续把"清单 ↔ cordis registry"对齐。删一行配置 = 对应能力消失并级联回滚;
> 服务回归时休眠插件自动复活。Node 档 11/11、typecheck 干净、设备档(Metro)双向验收通过。

## 改了什么

| 文件 | 变化 |
|---|---|
| `src/roster.ts`(新) | `RosterEntry{id,module,config}` / `RosterStore`(zustand vanilla,增删即通知)/ `defaultRoster(baseUrl)` |
| `src/modules.ts`(新) | 模块表:`module 键 → 工厂(env)`;未知键抛错。每次安装产出新插件对象(cordis 以 apply 为 registry 身份,新对象保证装卸互不串扰) |
| `src/index.ts`(重写) | `boot()` = slots + 空 Context + roster + **装配器**(差分同步:启动装满,此后增删行增量装卸;失败记日志不断链,初始装配失败则启动失败) |
| `src/types.ts` | `MAIN_SLOT` 常量移入共享层(chat-ui 与壳共用,消除字符串重复) |
| `tests/plugins.test.ts`(重写) | 旧"registry.delete 直接调"全部改走公开生命周期 API,新增 roster 验收组 |

## 关键语义(实测)

1. **依赖等待内建**:cordis fiber 的 inject 缺服务时保持 PENDING,服务出现自动激活——
   装配器无需拓扑排序;"只加回 connection 行,sessions/ui-chat 自动复活"直接通过。
2. **级联回滚**:remove dsh-connection → sessions/ui-chat 一并卸载,slot 清空。
3. **fail-loud**:未知模块名、重复 id、同模块二次挂载,全部立即抛错;
   异步同步阶段失败则记日志且保留清单行(下次同步可收敛),绝不静默吞行。

## 验收证据

- Node 档:`npm test` 11/11(`plugins.test.ts` 十项 + 真宿主往返一项);
- 设备档(Metro):
  - 删 `ui-chat` 行 → 冷启动 → 点启动 → 屏幕仅剩
    `slot 'main' 为空——没有任何插件注册界面`;
  - 加回该行 → 冷启动 → 聊天界面与隔离会话历史完整回归
    (`docs/p1-roster-restored.png`)。

## 新增工具

- `scripts/drive-emulator.sh`:模拟器驱动(launch/dump/tap-text/type/hide-keyboard/shot),
  远端 Mac 的 adb 全部 `</dev/null` 防 stdin 吞噬;keyevent 输入规避 Fabric 下 `input text`
  不触发 onChangeText 的坑。

## 移交 P2

roster 的来源从 `defaultRoster()` 换成后台 inventory RPC 投影,模块表的工厂换成
"ScriptManager 拉远端 chunk 取导出",其余零变化——北极星的最后一跳。
