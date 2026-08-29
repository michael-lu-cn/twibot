# MVP 实验报告（P0 最终态）

> 日期：2026-08-25
> 结论：**P0 全部通过。安卓端成功连接真实 dsh 后台，发送消息并收到真实模型回复。**

## 实验结果总表

| 实验 | Node 档 | 设备档（模拟器） | 通过标准 | 结果 |
|---|---|---|---|---|
| 0 引擎冒烟 | ✅ vitest 8/8 | ✅ 6/6 ✓ | Proxy trap + provide/dispose | **PASS** |
| 1 内核激活 | ✅ 含响应式收敛加测 | ✅ 判定 PASS | B 后激活；disposer 逆序 | **PASS** |
| 2 连真宿主 | ✅ 集成测试 5/5 | ✅ 收到模型回复 | 连接→建会话→发消息→收回复 | **PASS** |
| 3 Priority Slot | ✅ vitest 18/18 | ✅ B 胜出 | 低 priority 渲染；冲突抛错 | **PASS** |
| 4 动态 chunk | ➖ 脚手架就绪 | ⬜ 待测 | 不换 APK 出新 UI | P1+ |

## 真机验证的关键证据

实验 2 通过公网端点 `admin.dsh.port.dpdns.org` 完成：
- session.create → 返回 sessionId ✓
- session.prompt("你好") → 送达 dsh agent ✓
- agent 执行完毕 → assistant/message 事件到达客户端 ✓
- 回复文本："你好！我是运行在 DeepSeek Harness 里的编码助手……" ✓

服务端会话历史确认了完整的 user/message + assistant/chunk 流。

## 构建环境（aarch64 Linux）

| 组件 | 版本/来源 |
|---|---|
| Android Studio 2026.1.3.8 | DesktopECHO/aarch64-install 社区方案 |
| SDK 37.0.0 | HomuHomu833/android-sdk-custom（aarch64 musl） |
| NDK r30-beta2 | 同上 |
| JDK 17.0.20 | TUNA Adoptium 镜像 |
| adb 34.0.5 | Debian apt（RPATH 自包含） |
| cmake 3.31.6 + ninja | Debian apt（替换 x86_64 官方件） |

关键 Gradle 配置：
- `android.aapt2FromMavenOverride` → ARM64 aapt2
- `org.gradle.java.installations.paths` → JDK17
- `org.gradle.java.installations.auto-download=false`

## 发现与修复的 bug 清单

| # | 问题 | 修复 |
|---|---|---|
| 1 | /tmp 是 3.9G tmpfs，大解包 ENOSPC | TMPDIR 重定向到大盘 |
| 2 | pnpm v11 SQLite store 在沙箱内不可用 | 切换 npm workspaces |
| 3 | react peer version 冲突 | 放宽为 ^19.2.3 |
| 4 | hermesc "OS not recognized"（aarch64 Linux 无官方二进制） | hermesc shim：原样复制 JS bundle（Hermes 可执行源码模式） |
| 5 | expo prebuild 反复覆盖手动修改 | 补丁固化进 scripts/patch-gradle-mirrors.sh |
| 6 | Metro 缓存导致源码修改不生效 | rm -rf app/build/generated/assets/react 强制重建 |
| 7 | prompt() 参数 text 与局部变量 text 同名遮蔽 | 重命名为 replyText |
| 8 | finalAssistantText 只取末条 assistant/message（可能为空） | 聚合全部非空文本 + text-delta 兜底 |
| 9 | Mac forwarder Host 改写方向错误 | 保留原始 Host（loopback 天然合规） |
| 10 | RN fetch POST 带 Origin 与改写后 Host 不匹配 → 栅栏 403 | 转发器剥离 Origin/Sec-Fetch-* 头 |

## JSC → Hermes 范式转移

原计划假设动态插件加载必须用 JSC（new Function）。实际发现：

**状态全在服务端。客户端只是投影渲染器。**

因此"加载新插件"可以通过 bundle 热更新实现：
1. 模型写好插件代码
2. 服务端编译进新 JS bundle
3. 推送到客户端 → reload → 新功能出现
4. 因为状态在服务端，reload 无损

JSC 从"P2-P4 的硬前提"降级为"可选优化"。Hermes + 在线 bundle 更新即可满足需求。

生产热更新方案：Expo Updates 或自建 bundle 分发（dsh 自身可托管 `/android-face/bundle.hbc`）。

## 剩余跟进项

| # | 项 | 优先级 | 说明 |
|---|---|---|---|
| 1 | 杀进程重开恢复测试 | P0 打磨项 | resume() 已写好，需真机验证 |
| 2 | UI 滚动显示优化 | 低 | 回复文本在屏幕下方需滚动可见 |
| 3 | 移除 WS-DEBUG/PROMPT-DEBUG 临时日志 | P1 前 | 生产构建清理 |
| 4 | JSC 打包深度研究 | P2 前 | 如果最终仍需 new Function 场景 |

## P0 → P1 过渡清单

P1 目标：模块表 + slot 注册表 + 静态 roster（Cordis 模式开发）

1. 把 DshClient 注册为 Cordis 服务（`ctx.provide('dsh', client)`）
2. 每个 UI 区块变成一个 Cordis 插件（inject: ['dsh'] → apply 里注册组件到 slot）
3. 卸载 = entry 移除 → effect 回滚 → 组件消失
4. 验证标准：删一行 roster 配置对应 UI 消失
