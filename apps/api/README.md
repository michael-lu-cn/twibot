# twibot apps/api

dsh 形态的宿主进程：一棵 Cordis 插件树，一切能力来自 `apps/api/cordis.yml` 里的插件行。

## 快速开始

```bash
pnpm install
pnpm --filter @twibot/api dev      # 或 start；默认 http://127.0.0.1:12000
```

验证：

```bash
curl http://127.0.0.1:12000/api/health    # {"ok":true,...}
curl http://127.0.0.1:12000/api/hello     # 跨插件 inject：core-hello provide → api-server 消费
curl http://127.0.0.1:12000/api/inspect   # 树里活着的 entry 列表
pnpm --filter @twibot/api exec tsx src/bin.ts --dump-config   # 离线合成，与真实启动零偏差
```

关注列表（sync-following 插件）：

```bash
curl http://127.0.0.1:12000/api/following          # 本地读取（未同步 404 NOT_SYNCED / 未识别账号 NO_ME）
curl -X POST http://127.0.0.1:12000/api/following/sync   # 识别当前登录账号（书签页）并增量同步关注列表
```

本地 mock 全链路（无需外网）：`node apps/api/scripts/mock-x.mjs` 后带 `--patch scripts/mock-overlay.yml` 启动，
覆盖 `core-session.proxy: ""`（本地直连）与 `sync-following.baseUrl` 指向 mock。

## CLI

| flag | 作用 |
|---|---|
| `--dump-config` | 打印合成后的插件树（与启动同一 `applyEntryPatches` 路径） |
| `--config <file>` | 根配置（默认 `apps/api/cordis.yml`） |
| `--patch <file>` | overlay patch（可多次），按序应用在根配置之上 |
| `--port` / `--host` | 派生 patch，覆盖 `api-server` 行 |

## 层叠顺序

`cordis.yml`（product config）→ `--patch overlay`（命令行，按序）→ 派生 patch（`--port/--host`）。
patch 语义与 dsh 一致：按 `id` 定位行、`config` 整行替换、`insert` 插入新行。

## 内核来源

`packages/{cordis,loader,include,group,cosmokit}` 为 DeepSeek Harness `vendor/` 的源码拷贝
（包名保留 `@deepseek-ai/*`），exports 改指 `src/index.ts` 以便 tsx 直接消费源码；
`boot.ts` 的 `TwibotInclude` 用 `createRequire`（以配置目录为根）解析 bare 插件包名，
不依赖 Node 内部 module loader（无需 `--expose-internals`）。

## M0 已验证（需求文档 1.0）

- H1 入口薄壳（`bin.ts` 零业务）、H2 boot 序列、H3 动态 import、H4 配置层叠 + dump 零偏差、H5 effect 可逆
- A9 fail loud（依赖缺失点名报错）、A10 dump 一致、A11 薄壳、A12 删行即消失