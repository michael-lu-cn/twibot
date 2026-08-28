import { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-loader'
import { readFileSync } from 'node:fs'
import * as yaml from 'js-yaml'

/**
 * Offline compose: read the root config, apply overlay patches with the exact
 * same algorithm the mounted include applies at boot, and render the result.
 * Shares `applyEntryPatches` with the real boot path, so `--dump-config` can
 * never drift from what actually starts.
 */
export function dumpConfig(configPath: string, patches: readonly PatchOptions[]): string {
  const raw = readFileSync(configPath, 'utf8')
  const data = yaml.load(raw, { schema: entryListSchema })
  if (!Array.isArray(data)) {
    throw new Error(`config file must be a top-level array: ${configPath}`)
  }
  const composed = applyEntryPatches(data, patches, (message, ...args) => {
    console.warn(message, ...args)
  })
  return yaml.dump(composed, { schema: entryListSchema, noRefs: true })
}