// What the Testing Library plugin is allowed to call a query.
//
// The plugin matches a query by name, `/^(get|query|find)(All)?By.+$/`, and in its default "aggressive"
// mode treats every match as one so that a project's own `findByLabel` wrapper is linted like the
// built-in it wraps. In a Payload project that reach lands on the framework itself: `payload.findByID`
// matches, so every read in an integration spec was reported as an unhandled query, and the autofix put
// `await` in front of the ARGUMENT rather than the call - `ploaness format` turning a correct spec into
// one that no longer type-checks, with a suppression as the only repair left.
//
// The setting narrows detection to the built-in names. What is asserted here is the wiring: the setting
// is off, and the rules still reach a plain `.ts` integration spec, because the other repair available
// for the same defect - scoping the block to `.tsx` - would have left every `.ts` spec unlinted. The
// behaviour itself is proven where a real project and a real tsconfig exist, since the type-aware parser
// this config mounts refuses a spec that no project owns.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import payloadConfig from '../dist/eslint.js'

const CUSTOM_QUERIES: string = 'testing-library/custom-queries'
const ASYNC_QUERIES: string = 'testing-library/await-async-queries'
const INTEGRATION_SPEC: string = 'tests/int/example.int.spec.ts'
const COMPONENT_SPEC: string = 'tests/component/example.component.spec.tsx'
const SOURCE_FILE: string = 'src/lib/example.ts'

const packageRoot: string = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

const severityOf = (setting: unknown): unknown => (Array.isArray(setting) ? setting[0] : setting)

const ENABLED: ReadonlySet<unknown> = new Set(['error', 2, 'warn', 1])

const configAt = async (filePath: string): Promise<Readonly<Record<string, unknown>>> => {
  const eslint: ESLint = new ESLint({
    overrideConfigFile: true,
    baseConfig: [...payloadConfig],
    cwd: packageRoot,
  })
  const resolved: unknown = await eslint.calculateConfigForFile(filePath)
  if (!isRecord(resolved)) {
    throw new TypeError(`${filePath} resolved to no configuration`)
  }
  return resolved
}

const settingAt = async (filePath: string): Promise<unknown> => {
  const resolved: Readonly<Record<string, unknown>> = await configAt(filePath)
  const settings: unknown = resolved['settings']
  return isRecord(settings) ? settings[CUSTOM_QUERIES] : undefined
}

const isRuleOnAt = async (filePath: string, rule: string): Promise<boolean> => {
  const resolved: Readonly<Record<string, unknown>> = await configAt(filePath)
  const rules: unknown = resolved['rules']
  return isRecord(rules) && ENABLED.has(severityOf(rules[rule]))
}

describe('what counts as a Testing Library query', () => {
  it('recognises only the built-in queries, so a Local API read is not one', async () => {
    expect(await settingAt(INTEGRATION_SPEC)).toBe('off')
    expect(await settingAt(COMPONENT_SPEC)).toBe('off')
  })

  // The repair had to keep the rules where they were. Scoping them to `.tsx` would have fixed the same
  // false positive by leaving every `.ts` spec unlinted, which is the trade this assertion refuses.
  it('keeps the rules on a plain .ts integration spec, not only on a .tsx component spec', async () => {
    expect(await isRuleOnAt(INTEGRATION_SPEC, ASYNC_QUERIES)).toBe(true)
    expect(await isRuleOnAt(COMPONENT_SPEC, ASYNC_QUERIES)).toBe(true)
  })

  // The block is still scoped to the suite: production source carries neither the rules nor the setting.
  it('reaches no production source', async () => {
    expect(await isRuleOnAt(SOURCE_FILE, ASYNC_QUERIES)).toBe(false)
    expect(await settingAt(SOURCE_FILE)).toBeUndefined()
  })
})
