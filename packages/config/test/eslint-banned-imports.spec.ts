// The joint between the two package bans the shipped configs carry and the one rule that states them.
//
// `no-restricted-imports` REPLACES rather than merges, exactly as `no-restricted-syntax` and
// `no-restricted-properties` do, so a later block setting that key for any narrower glob would silently
// drop whichever list it did not restate. The mock half of it shipped for a long time with no test at
// all; the web-simulation half is added beside it here, which is what makes both halves worth asserting
// together rather than one at a time.
//
// The question is put to ESLint rather than to the source text, for the reason
// `eslint-test-scope.spec.ts` states: finding two lists spliced together in a file says nothing about
// how many survive the cascade.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint, type Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import payloadConfig from '../dist/eslint.js'
import libraryConfig from '../dist/eslint-library.js'

const configPackage: string = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** One file of each role the ban has to survive into. */
const PRODUCTION_FILE: string = 'src/lib/example.ts'
const SPEC_FILE: string = 'tests/unit/example.spec.ts'

// Both halves of the ban, named rather than imported from the tables. A test that read the same
// constant the rule reads would agree with itself however the two drifted apart.
const BANNED_MOCKING: readonly string[] = ['sinon', 'testdouble', 'nock', 'msw']
const BANNED_WEB_SIMULATION: readonly string[] = ['node-mocks-http', 'light-my-request']

// `supertest` binds a real ephemeral port, which is what the governing standard asks an endpoint test
// to do. Asserting it stays permitted is what stops the list growing into a ban on real servers.
const PERMITTED: readonly string[] = ['supertest']

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

const restrictedNames = async (
  config: readonly Linter.Config[],
  filePath: string,
): Promise<readonly string[]> => {
  const eslint: ESLint = new ESLint({
    overrideConfigFile: true,
    baseConfig: [...config],
    cwd: configPackage,
  })
  const resolved: unknown = await eslint.calculateConfigForFile(filePath)
  const rules: unknown = isRecord(resolved) ? resolved['rules'] : undefined
  const entry: unknown = isRecord(rules) ? rules['no-restricted-imports'] : undefined
  if (!Array.isArray(entry)) {
    throw new TypeError(`no-restricted-imports resolved to nothing for ${filePath}`)
  }
  const options: unknown = entry[1]
  const paths: unknown = isRecord(options) ? options['paths'] : undefined
  if (!Array.isArray(paths)) {
    throw new TypeError('no-restricted-imports names no paths')
  }
  return paths.map((shape: unknown): string => {
    const name: unknown = isRecord(shape) ? shape['name'] : undefined
    if (typeof name !== 'string') {
      throw new TypeError('a no-restricted-imports entry names no package')
    }
    return name
  })
}

const shippedConfigs: Readonly<Record<string, readonly Linter.Config[]>> = {
  payload: payloadConfig,
  library: libraryConfig,
}

/** What one config resolved for one file, labelled so a failure says which pair produced it. */
interface Resolution {
  readonly label: string
  readonly banned: readonly string[]
}

// Every config against every file role, resolved once. Flattened rather than nested three deep because
// each assertion below would otherwise carry two loops of its own before reaching its subject.
const everyResolution = async (): Promise<readonly Resolution[]> =>
  await Promise.all(
    Object.entries(shippedConfigs)
      .flatMap(([name, config]: [string, readonly Linter.Config[]]) =>
        [PRODUCTION_FILE, SPEC_FILE].map((file: string) => ({
          label: `${file} in the ${name} config`,
          config,
          file,
        })),
      )
      .map(
        async (pair): Promise<Resolution> => ({
          label: pair.label,
          banned: await restrictedNames(pair.config, pair.file),
        }),
      ),
  )

const expectBanned = (resolutions: readonly Resolution[], libraries: readonly string[]): void => {
  for (const resolution of resolutions) {
    for (const library of libraries) {
      expect(resolution.banned, `${library} at ${resolution.label}`).toContain(library)
    }
  }
}

describe('the banned-import list survives the cascade', () => {
  it('bans every mocking library in both configs, on production code and on a spec', async () => {
    const resolutions: readonly Resolution[] = await everyResolution()
    expect(resolutions.length).toBeGreaterThan(0)
    expectBanned(resolutions, BANNED_MOCKING)
  })

  it('bans every simulated web layer in both configs, on production code and on a spec', async () => {
    const resolutions: readonly Resolution[] = await everyResolution()
    expect(resolutions.length).toBeGreaterThan(0)
    expectBanned(resolutions, BANNED_WEB_SIMULATION)
  })

  // The two halves are one setting, so the way either is lost is a later block restating the other.
  it('carries both halves at once rather than whichever was written last', async () => {
    const resolutions: readonly Resolution[] = await everyResolution()
    for (const resolution of resolutions) {
      expect(resolution.banned, `the mock half at ${resolution.label}`).toContain('sinon')
      expect(resolution.banned, `the web half at ${resolution.label}`).toContain('node-mocks-http')
    }
  })

  it('leaves a real server on a local port permitted', async () => {
    const resolutions: readonly Resolution[] = await everyResolution()
    for (const resolution of resolutions) {
      for (const library of PERMITTED) {
        expect(resolution.banned, `${library} at ${resolution.label}`).not.toContain(library)
      }
    }
  })
})
