// What the shipped configs make of the process, as opposed to of the program's own data.
//
// `functional/immutable-data` is aimed at mutating a data structure. Two things a governed project must
// write are not that, and both were reported until this carve-out existed:
//
//   - `process.exitCode = n`, which is a program's verdict. `unicorn/no-process-exit` arrives on by
//     preset and bans `process.exit()`, so with no carve-out here a Node entry point had NO legal
//     spelling of a non-zero exit and every governed `scripts/` paid a suppression for its last line.
//   - `process.env.X = v` in the setup file, whose whole job is configuring the process before any spec
//     reads it. ploaness exempts its OWN setup file from this rule and shipped no equivalent, while
//     banning `vi.stubEnv`, requiring the Vitest config to be a bare re-export so `test.env` cannot be
//     added, and running the runner directly rather than through a package script.
//   - `process.env.X = v` in a SPEC, which is the half the setup file's carve-out does not cover. A
//     setup file fixes the environment once for the whole run; a branch taken only when a variable is
//     unset and another taken only when it is set cannot both be observed from one fixed value. With
//     every other mechanism banned, an environment-dependent branch was unreachable by any legal test
//     while the coverage floor still required it.
//
// Read through `calculateConfigForFile` rather than from the source, because the cascade is what drifts:
// a block that sets this rule REPLACES its options rather than adding to them, so the setup file's block
// keeps `process.exitCode` only because the shared constructor rebuilds it. Written out by hand there,
// the base carve-out would vanish for that one file and no source read would show it.
//
// Every assertion is keyed by config rather than repeated per config with a label, because `expect` takes
// no message here: a keyed record puts the failing config's name in the diff, which is what a label was
// for, and asserts the two configs agree in the same breath.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROJECT_SETUP_FILE, requiredBiomeFiles } from '@ploaness/governance'
import { ESLint, Linter } from 'eslint'
import functionalPlugin from 'eslint-plugin-functional'
import { describe, expect, it } from 'vitest'
import payloadConfig from '../dist/eslint.js'
// The build output, not the source, for the reason `vitest-config.spec.ts` states.
import libraryConfig from '../dist/eslint-library.js'

// Plugin resolution happens relative to this, and pnpm's strict layout only exposes `eslint-plugin-*` to
// the package that declares them - so a run rooted anywhere else resolves nothing.
const configPackage: string = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const RULE: string = 'functional/immutable-data'
const PROCESS_EXIT_RULE: string = 'unicorn/no-process-exit'
const NO_LET_RULE: string = 'functional/no-let'
const VERDICT: string = 'process.exitCode'
const ENVIRONMENT: string = 'process.env.*'
const RUNTIME_GLOBALS: string = 'globalThis'
const GLOBAL_ASSIGNMENT_RULE: string = 'unicorn/no-global-object-property-assignment'

const SOURCE_FILE: string = 'src/lib/example.ts'
const SPEC_FILE: string = 'tests/unit/example.spec.ts'

const shippedConfigs: Readonly<Record<string, readonly Linter.Config[]>> = {
  payload: payloadConfig,
  library: libraryConfig,
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

const sorted = (values: readonly string[]): readonly string[] =>
  [...values].sort((left: string, right: string): number => left.localeCompare(right))

// The awaited value lands in `unknown` rather than in an annotation, because `calculateConfigForFile` is
// declared to return `any` and an annotation would let that `any` through under a name that looks typed.
const resolveRules = async (
  config: readonly Linter.Config[],
  filePath: string,
): Promise<Readonly<Record<string, unknown>>> => {
  const eslint: ESLint = new ESLint({
    overrideConfigFile: true,
    baseConfig: [...config],
    cwd: configPackage,
  })
  const resolved: unknown = await eslint.calculateConfigForFile(filePath)
  if (!(isRecord(resolved) && isRecord(resolved['rules']))) {
    throw new TypeError(`${filePath} resolved to no rules`)
  }
  return resolved['rules']
}

/** The accessors the rule is told to leave alone at one path, sorted so two configs compare directly. */
const exemptAccessorsOf = async (
  config: readonly Linter.Config[],
  filePath: string,
): Promise<readonly string[]> => {
  const rules: Readonly<Record<string, unknown>> = await resolveRules(config, filePath)
  const setting: unknown = rules[RULE]
  if (!Array.isArray(setting)) {
    throw new TypeError(`${RULE} is unset at ${filePath}`)
  }
  const options: unknown = setting[1]
  const patterns: unknown = isRecord(options) ? options['ignoreAccessorPattern'] : undefined
  if (!Array.isArray(patterns)) {
    throw new TypeError(`${RULE} carries no accessor list at ${filePath}`)
  }
  return sorted(patterns.map(String))
}

/** What every shipped config exempts at one path, keyed by config so a failure names which one drifted. */
const accessorsAt = async (
  filePath: string,
): Promise<Readonly<Record<string, readonly string[]>>> =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(shippedConfigs).map(
        async ([name, config]: [string, readonly Linter.Config[]]): Promise<
          readonly [string, readonly string[]]
        > => [name, await exemptAccessorsOf(config, filePath)],
      ),
    ),
  )

/** The same answer expected of every config, which is the property: neither may drift from the other. */
const everyConfig = <Value>(value: Value): Readonly<Record<string, Value>> =>
  Object.fromEntries(
    Object.keys(shippedConfigs).map((name: string): readonly [string, Value] => [name, value]),
  )

const inEveryConfig = (accessors: readonly string[]): Readonly<Record<string, readonly string[]>> =>
  everyConfig(sorted(accessors))

const carriesAccessor = (
  byConfig: Readonly<Record<string, readonly string[]>>,
  accessor: string,
): boolean =>
  Object.values(byConfig).some((accessors: readonly string[]): boolean =>
    accessors.includes(accessor),
  )

/**
 * Whether one rule is declared at ordinary source, keyed by config so a failure names which one drifted.
 *
 * Two carve-outs below are each load-bearing only while a DIFFERENT rule stays on, and asking that
 * question twice by hand is what put this file over the function-length cap - the cap noticing a
 * duplication rather than a long test.
 */
const declaredInEveryConfig = async (rule: string): Promise<Readonly<Record<string, boolean>>> =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(shippedConfigs).map(
        async ([name, config]: [string, readonly Linter.Config[]]): Promise<
          readonly [string, boolean]
        > => {
          const rules: Readonly<Record<string, unknown>> = await resolveRules(config, SOURCE_FILE)
          return [name, rules[rule] !== undefined]
        },
      ),
    ),
  )

/**
 * What one snippet reports at one path under the SHIPPED setting for this rule, keyed by config.
 *
 * Read back out of the config rather than written here, so it asserts what a consumer's own file is told
 * rather than that a literal in this file equals itself.
 */
const findingsAt = async (
  code: string,
  filePath: string,
): Promise<Readonly<Record<string, readonly string[]>>> =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(shippedConfigs).map(
        async ([name, config]: [string, readonly Linter.Config[]]): Promise<
          readonly [string, readonly string[]]
        > => {
          const rules: Readonly<Record<string, unknown>> = await resolveRules(config, filePath)
          const messages: readonly Linter.LintMessage[] = new Linter().verify(code, {
            plugins: { functional: functionalPlugin },
            rules: { [RULE]: rules[RULE] as Linter.RuleEntry },
          })
          return [name, messages.map((message: Linter.LintMessage): string => message.ruleId ?? '')]
        },
      ),
    ),
  )

describe("a program's verdict, which is not data it owns", () => {
  // The carve-out is load-bearing only while the OTHER spelling stays banned. If this rule were ever
  // turned off, `process.exit()` would be legal again and the exemption below would be a convenience
  // rather than the single door it is meant to be.
  it('is the only door left open, because the other spelling of an exit stays banned', async () => {
    expect(await declaredInEveryConfig(PROCESS_EXIT_RULE)).toStrictEqual(everyConfig(true))
  })

  it('admits a program its verdict, in every config and in ordinary source', async () => {
    expect(await accessorsAt(SOURCE_FILE)).toStrictEqual(inEveryConfig([VERDICT]))
  })
})

// Split from the block above because the two carve-outs answer to different things: an exit code is what
// a program RETURNS, and the environment is what it READS. Sharing one describe also put the file over
// the function-length cap, which is the cap noticing the same seam.
describe('the environment, and the two roles that may set it', () => {
  // The replacement trap, as a property. A block setting this rule discards the options a prior block
  // supplied, so the setup file keeps its verdict carve-out only because the shared constructor rebuilds
  // it. Stated by hand there, `process.exitCode` would silently stop being exempt in that one file.
  it('adds the environment WITHOUT dropping what the base block stated, at both paths', async () => {
    expect(await accessorsAt(PROJECT_SETUP_FILE)).toStrictEqual(
      inEveryConfig([RUNTIME_GLOBALS, ENVIRONMENT, VERDICT]),
    )
    expect(await accessorsAt(SPEC_FILE)).toStrictEqual(inEveryConfig([ENVIRONMENT, VERDICT]))
  })

  // Without this the exemption is a hole rather than a role: each path earns it by being somewhere
  // process configuration legitimately happens - the setup file fixes it, a spec varies it - so every
  // other path must still be reported. Asked of the paths as a set rather than one at a time, so the
  // answer is which files admit it rather than whether one does. `src/lib/example.ts` is the one that
  // must keep saying no: a module that writes the environment it is supposed to read is the defect this
  // rule is aimed at, and widening the carve-out to a spec must not reach it.
  it('admits the environment in the suite and in the setup file, and at no other path', async () => {
    const paths: readonly string[] = [SOURCE_FILE, SPEC_FILE, PROJECT_SETUP_FILE]
    const found: readonly (readonly string[])[] = await Promise.all(
      paths.map(async (filePath: string): Promise<readonly string[]> => {
        const byConfig: Readonly<Record<string, readonly string[]>> = await accessorsAt(filePath)
        return carriesAccessor(byConfig, ENVIRONMENT) ? [filePath] : []
      }),
    )
    expect(found.flat()).toStrictEqual([SPEC_FILE, PROJECT_SETUP_FILE])
  })

  // The exemption is the environment and NOTHING else. A spec that may set `process.env` must still be
  // held to every other immutability rule, or the carve-out stops being about the process and becomes a
  // relaxation of the suite - which is the shape the setup file's block was deliberately written to
  // avoid one level up, by being a block rather than a whole-file `ignores` entry.
  it('leaves a spec held to no-let, so the carve-out is the environment and not the suite', async () => {
    const held: Readonly<Record<string, unknown>> = Object.fromEntries(
      await Promise.all(
        Object.entries(shippedConfigs).map(
          async ([name, config]: [string, readonly Linter.Config[]]): Promise<
            readonly [string, unknown]
          > => {
            const rules: Readonly<Record<string, unknown>> = await resolveRules(config, SPEC_FILE)
            const setting: unknown = rules[NO_LET_RULE]
            // `calculateConfigForFile` normalises a severity to its numeric form in a one-element
            // array, so the shipped `'error'` reads back as `[2]`.
            return [name, Array.isArray(setting) ? setting[0] : setting]
          },
        ),
      ),
    )
    expect(held).toStrictEqual(everyConfig(2))
  })

  // The setup file is named by two things that cannot see each other: the Biome block a consumer must
  // carry verbatim, and the ESLint block that gives the file its role. A rename reaching one and not the
  // other leaves a project whose setup file is formatted but not exempt, or exempt but not formatted.
  it('names the same setup file the required Biome block does', () => {
    const includes: unknown = requiredBiomeFiles(['src'])['includes']
    expect(Array.isArray(includes) ? includes : []).toContain(PROJECT_SETUP_FILE)
  })
})

// The third role that file holds, and the narrowest. The two above are about the process; this one is
// about the RUNTIME the process is running the suite in.
//
// ploaness mandates jsdom for `tests/component/**` and jsdom implements no `matchMedia`, no
// `ResizeObserver`, no `IntersectionObserver`. Supplying one was reported by every route: `vi.stubGlobal`
// by the mock ban, `test.environmentOptions` by the Vitest config having to be a bare re-export, and both
// spellings of an assignment by `functional/immutable-data`. A harness that REQUIRES an environment and
// then reports the only means of completing it is the shape this repository fixes by narrowing.
describe('the test runtime, and the one place it may be completed', () => {
  // The carve-out is load-bearing only while the sloppy spelling stays banned - the same property the two
  // describes above assert of `process.exit()`. This rule bans `globalThis.x = fn` and names
  // `Object.defineProperty` as its fix, so with it off the exemption would be a convenience.
  it('is the only door left open, because assigning onto the global stays banned', async () => {
    expect(await declaredInEveryConfig(GLOBAL_ASSIGNMENT_RULE)).toStrictEqual(everyConfig(true))
  })

  // Narrower than the environment carve-out beside it, deliberately. A spec MAY vary the environment,
  // because a branch taken only when a variable is set cannot otherwise be reached; it may not swap a
  // global, because a global installed for one case and not restored is visible to every case after it -
  // which is the leak `vi.stubGlobal` is banned for. An API the runtime simply lacks is a fact about the
  // run, so once per run is the granularity, and `vitest.setup.ts` is where a run is configured.
  it('admits completing the runtime in the setup file, and at no other path', async () => {
    const paths: readonly string[] = [SOURCE_FILE, SPEC_FILE, PROJECT_SETUP_FILE]
    const found: readonly (readonly string[])[] = await Promise.all(
      paths.map(async (filePath: string): Promise<readonly string[]> => {
        const byConfig: Readonly<Record<string, readonly string[]>> = await accessorsAt(filePath)
        return carriesAccessor(byConfig, RUNTIME_GLOBALS) ? [filePath] : []
      }),
    )
    expect(found.flat()).toStrictEqual([PROJECT_SETUP_FILE])
  })

  // Why the pattern carries no trailing `.*`, asserted rather than described. An accessor pattern matches
  // the path being written: `Object.defineProperty(globalThis, ...)` writes to the bare argument, so
  // `globalThis` admits it, while `globalThis.matchMedia = fn` writes to `globalThis.matchMedia`, which
  // `globalThis` does not match - and stays reported, by this rule as well as by the one above.
  //
  // Read back out of the shipped config and handed to the linter, so it asserts what a consumer's setup
  // file is actually told rather than what this package's source happens to spell. Only the assignment
  // half is checkable here: the `defineProperty` half of the rule asks the type-checker, which a bare
  // `Linter` has no program for, and the settings assertion above is what guards that half from drift.
  it('leaves an assignment onto a global reported, which is what the missing `.*` buys', async () => {
    const findings: Readonly<Record<string, readonly string[]>> = await findingsAt(
      'globalThis.matchMedia = fn',
      PROJECT_SETUP_FILE,
    )
    expect(findings).toStrictEqual(everyConfig([RULE]))
  })
})
