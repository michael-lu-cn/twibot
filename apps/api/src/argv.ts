import type { PatchOptions } from '@deepseek-ai/cordis-plugin-loader'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { existsSync, readFileSync } from 'node:fs'
import * as yaml from 'js-yaml'

/** Parsed CLI options for the api bin. */
export interface CliOptions {
  /** Root config path (default: apps/api/cordis.yml). */
  configPath: string | undefined
  /** Overlay patch files in order (--patch <file>, repeatable). */
  patches: string[]
  /** Port override (--port). */
  port: number | undefined
  /** Bind host override (--host). */
  host: string | undefined
  /** Print the composed plugin tree and exit (--dump-config). */
  dumpOnly: boolean
}

/** Hand-rolled thin argv parser; no flag library needed for two flags. */
export function parseArgv(argv: string[]): CliOptions {
  const opts: CliOptions = { configPath: undefined, patches: [], port: undefined, host: undefined, dumpOnly: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--dump-config':
        opts.dumpOnly = true
        break
      case '--config':
        opts.configPath = argv[++i]
        break
      case '--patch':
        opts.patches.push(argv[++i]!)
        break
      case '--port':
        opts.port = Number(argv[++i])
        break
      case '--host':
        opts.host = argv[++i]
        break
      default:
        throw new Error(`unknown argument: ${arg}`)
    }
  }
  return opts
}

/**
 * Load overlay patch files. A patch file is a top-level YAML array of patch
 * rows (`id`/`insert` semantics from the include plugin). Missing or invalid
 * files fail loud.
 */
export function loadOverlayPatches(files: readonly string[]): PatchOptions[] {
  const out: PatchOptions[] = []
  for (const file of files) {
    if (!existsSync(file)) throw new Error(`--patch file not found: ${file}`)
    const data = yaml.load(readFileSync(file, 'utf8'), { schema: entryListSchema })
    if (!Array.isArray(data)) throw new Error(`patch file must be a top-level array: ${file}`)
    out.push(...(data as PatchOptions[]))
  }
  return out
}