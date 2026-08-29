# @face/shell —— Cordis Face 壳（设备侧运行手册）

> 构建路径已切换：本机为 **aarch64 Linux**，采用社区方案 [android-studio-aarch64-install](https://gist.github.com/DesktopECHO/a35f0fb2cedbd699a8103b20dbd3c53f)（ARM64 原生 SDK 37 + NDK r30 + aapt2/zipalign 替换 + 用户级 Gradle override）实现**本机出包**；EAS 云构建保留为兜底（eas.json 已就位）。

## 0. 本机环境状态（全部就绪 ✅）

| 组件 | 位置 |
|---|---|
| adb 34.0.5 aarch64 | `~/.local/bin/adb`（RPATH 自包含；SDK 内副本同步） |
| Android Studio 2026.1.3.8 + JBR | `~/.local/share/android-studio/` |
| **JDK 17**（RN gradle 插件工具链强制要求） | `~/Android/jdk17`（TUNA Temurin） |
| SDK 37.0.0（aapt2/zipalign ARM64 原生） | `~/Android/Sdk` |
| NDK r30-beta2 aarch64，别名目录 `27.1.12297006` | `~/Android/Sdk/ndk/` |
| cmake 3.31.6 + ninja（aarch64，Debian 版替换 x86 官方件） | `~/Android/Sdk/cmake/3.22.1/bin` |

关键配置：`~/.gradle/gradle.properties` 含 `android.aapt2FromMavenOverride` 指向 ARM64 aapt2、`org.gradle.java.installations.paths=jdk17` 且禁用自动下载。

## 1. 构建（已验证可用）

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export JAVA_HOME="$HOME/Android/jdk17"        # 必须真 JDK17：JBR25 会污染 CMake 任务 stderr
export TMPDIR="$HOME/Android/tmp"             # /tmp 是 3.9G tmpfs，大解包会 ENOSPC
cd android-face/apps/shell/android
./gradlew assembleDebug --no-daemon           # 首次 ~10 分钟，之后增量秒级
# 产物: app/build/outputs/apk/debug/app-debug.apk (131MB, jsEngine=jsc 已固化)
```

工程内补丁（prebuild 后需重打，见 `../scripts/patch-gradle-mirrors.sh`）：settings/build.gradle 前置阿里云仓库、wrapper 走腾讯 gradle 镜像。

## 2. 实验拓扑（宿主零改动）

**方案 A（默认）：公网域名直连 —— 真机任意网络可用**

```bash
# 本机（dev host 所在机器）
export DEEPSEEK_API_KEY=... && pnpm dsh web   # 127.0.0.1:3080
# 本机已配置 portless：http://admin.dsh.port.dpdns.org/ 任意公网可达本机 dsh 宿主
```

设备侧 App 默认宿主即公网域名（App.tsx `DEFAULT_HOST`），真机在蜂窝/Wi-Fi 下均可直连，
无需 adb reverse；`tests/real-host.test.ts` 的默认 `DSH_HOST` 同源。

⚠️ 该域名等于把无鉴权的 dsh 暴露到公网（`session.prompt` 即 RCE），仅用于开发期，勿承载敏感会话。

**方案 B（离线兜底）：USB reverse**

```bash
adb reverse tcp:3080 tcp:3080                 # 设备侧获得 127.0.0.1:3080
```

不要用 `--host 0.0.0.0`：CLI 直接拒绝；LAN 直连被"无认证层 + 特权方法 loopback-only"三重堵死
（临时放行可用 `scripts/dev-host-gate-bypass.mjs` 改写 Host 头）。

## 3. 面板操作 ↔ 实验判定

| 面板区块 | 实验 | 通过标准 |
|---|---|---|
| 引擎冒烟 | 实验 0 | 全部 ✓（含 set-trap 异步项） |
| 内核激活 | 实验 1 | 判定行显示 PASS（b-sees → disposed:b → disposed:a 逆序） |
| Priority Slot | 实验 3 | 注册/切换后"更小 priority 胜出"，无重启 |
| 连真宿主 | 实验 2 | 真模型回复上屏；杀进程重开能整页恢复 |

## 4. 实验 4（动态 chunk）

1. 宿主机另开终端跑 `pnpm run dev:web`（client bundle watcher——不跑 watcher 宿主不会重建 chunk）。
2. 构建 `apps/remote-chunk-demo` 为独立 chunk 并放到宿主 `/plugins/<id>/client.js` 可服务位置。
3. App 内触发 `loadPluginChunk('demo-greeter')` → 新 UI 以更高优先级出现在 slot。
4. 已知坑：production chunk 加载错误会绕过 Error Boundary 直接崩溃（repack 2026-07 issue），实验期保持 dev build。

## 5. 阻塞点记录（本机无法验证项）

- [ ] JDK / Android SDK / NDK / CMake 安装（磁盘 ≥25GB，本机仅剩 3GB）
- [ ] 真机或模拟器上的实验 0（Hermes/JSC Proxy 行为差异只能在真引擎验证）
- [ ] 实验 2 的"真模型回复"需要 DEEPSEEK_API_KEY；无 key 时可用 mock host 验证传输层
- [ ] adb reverse 需要物理设备连接或无线调试配对
