import { Context } from '@deepseek-ai/cordis'
import Group from '@deepseek-ai/cordis-plugin-group'
import { Include, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { Loader, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Root include that resolves bare package specifiers (`@twibot/*`) from the
 * config directory instead of the vendored loader's own node_modules.
 *
 * dsh uses Node's internal module loader for this; twibot sidesteps it with a
 * plain `createRequire` rooted at the config directory, so no
 * `--expose-internals` / native `node-addon-require-builtin` is needed.
 * `cordis:` builtins and relative specifiers keep their original handling.
 */
class TwibotInclude extends Include {
  private require = createRequire(pathToFileURL(join(dirname(this.filename), 'package.json')).href)

  override import(name: string, getOuterStack?: () => string[]): unknown {
    if (name.startsWith('cordis:') || name.startsWith('.')) return super.import(name, getOuterStack)
    try {
      const resolved = this.require.resolve(name)
      return super.import(pathToFileURL(resolved).href, getOuterStack)
    } catch {
      // 保留原解析路径的报错信息（fail loud）
      return super.import(name, getOuterStack)
    }
  }
}

/**
 * Mount the root config file as a `cordis:include` entry through the Loader,
 * applying overlay patches in order. The include parses the file itself with
 * the same patch algorithm the offline dump uses, so a dump and a real boot
 * can never drift.
 */
export async function mountRootInclude(
  ctx: Context,
  absoluteConfigPath: string,
  patches: readonly PatchOptions[] = [],
): Promise<string> {
  ctx.loader.builtins.include = TwibotInclude
  ctx.loader.builtins.group = Group
  const includeConfig: Include.Config = {
    path: pathToFileURL(absoluteConfigPath).href,
    ...(patches.length > 0 ? { patches: [...patches] } : {}),
  }
  const rootInclude: EntryOptions = {
    id: 'include',
    name: 'cordis:include',
    config: includeConfig,
  }
  return ctx.loader.create(rootInclude)
}

export interface BootOptions {
  /** Absolute path of the root cordis.yml. */
  configPath: string
  /** Overlay patches applied over the config file, in order. */
  patches?: readonly PatchOptions[]
  /** Host setup run after the Loader service exists and before entries mount. */
  prepare?: (ctx: Context) => void | Promise<void>
}

/**
 * dsh-style boot sequence: load env → new Context(baseUrl) → install Loader →
 * prepare → mount root include → settle the tree → assert every entry active.
 * On failure the partial context is disposed and the error re-thrown.
 */
export async function boot(binName: string, opts: BootOptions): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(dirname(opts.configPath)).href + '/'
  try {
    await ctx.plugin(Loader)
    await opts.prepare?.(ctx)
    await mountRootInclude(ctx, opts.configPath, opts.patches ?? [])
    await ctx.get('loader')?.await()
    await assertEntriesActivated(ctx, binName)
    return ctx
  } catch (cause) {
    await ctx.fiber.dispose().catch(() => {})
    throw cause
  }
}

// ─── assertEntriesLoaded / assertEntriesActivated（同 dsh 语义）────────────

/** Value mirrors because Cordis's const enum has no runtime object. */
const FIBER_PENDING = 0
const FIBER_ACTIVE = 2
const FIBER_FAILED = 3

/** Reject entries that never got a fiber (disabled entries are the only valid fiber-less state). */
export function assertEntriesLoaded(ctx: Context, binName: string): void {
  const failed = [...ctx.loader.entries()].filter((entry) => entry.fiber === undefined && !entry.disabled)
  if (failed.length > 0) {
    const names = failed.map((entry) => entry.options.name).join(', ')
    throw new Error(`${binName}: plugin(s) failed to load: ${names}; see the resolution errors above`)
  }
}

/** Reject a settled tree when an enabled entry failed or remains inactive (fail loud). */
export async function assertEntriesActivated(ctx: Context, binName: string): Promise<void> {
  assertEntriesLoaded(ctx, binName)
  const failures: string[] = []
  const rejections: unknown[] = []
  for (const entry of ctx.loader.entries()) {
    const fiber = entry.fiber
    if (fiber === undefined || entry.disabled) continue
    const state = fiber.state
    if (state === FIBER_ACTIVE) continue
    if (state === FIBER_FAILED) {
      try {
        await fiber.await()
      } catch (error) {
        rejections.push(error)
        failures.push(`${entry.options.name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
      }
      continue
    }
    if (state === FIBER_PENDING) {
      const missing = Object.keys(fiber.inject).filter((service) => fiber.ctx.get(service) === undefined)
      const subject = missing.length === 1 ? 'service' : 'services'
      failures.push(`${entry.options.name}: pending (waiting for ${subject}: ${missing.join(', ') || 'unknown'})`)
    } else {
      failures.push(`${entry.options.name}: fiber state ${String(state)}`)
    }
  }
  if (failures.length > 0) {
    const noun = failures.length === 1 ? 'entry' : 'entries'
    throw new Error(`${binName}: ${String(failures.length)} ${noun} did not activate\n${failures.join('\n')}`)
  }
}