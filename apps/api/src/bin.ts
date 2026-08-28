#!/usr/bin/env node
/**
 * twibot api 入口薄壳（H1）：零业务逻辑。
 * 只做 argv → 选配置树 → boot()；一切能力来自树内插件。
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot } from './boot.ts'
import { dumpConfig } from './dump.ts'
import { loadOverlayPatches, parseArgv } from './argv.ts'

// 顶层 await 前的兜底：任何未处理拒绝都不能悄悄吞掉（fail loud）
process.on('unhandledRejection', (reason) => {
  console.error('[twibot] fatal unhandled rejection:', reason)
  process.exit(1)
})

const here = dirname(fileURLToPath(import.meta.url))
const defaultConfig = resolve(here, '..', 'cordis.yml')

const argv = parseArgv(process.argv.slice(2))
const configPath = resolve(argv.configPath ?? defaultConfig)
// 层叠顺序：cordis.yml（product config）→ --patch overlay（命令行）→ 派生 patch（--port/--host）
const overlays = loadOverlayPatches(argv.patches)

if (argv.dumpOnly) {
  process.stdout.write(dumpConfig(configPath, overlays))
  process.exit(0)
}

const derived: typeof overlays = []
if (argv.port !== undefined || argv.host !== undefined) {
  derived.push({
    id: 'api-server',
    config: {
      ...(argv.port !== undefined ? { port: argv.port } : {}),
      ...(argv.host !== undefined ? { host: argv.host } : {}),
    },
  })
}

const ctx = await boot('twibot', { configPath, patches: [...overlays, ...derived] })
const entries = [...ctx.loader.entries()].map((e) => e.id).join(', ')
console.log(`[twibot] ok, entries: ${entries || '(none)'}`)

ctx.on('exit', async () => {
  await ctx.fiber.dispose()
  process.exit(0)
})

async function shutdown(signal: string): Promise<void> {
  console.log(`[twibot] ${signal}, disposing tree...`)
  await ctx.fiber.dispose()
  process.exit(0)
}
process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))