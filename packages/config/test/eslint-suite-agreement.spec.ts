// The joint between what the runner collects and what the linter judges.
//
// The two shipped configs decide this separately and nothing compared them, so they drifted: `vitest.ts`
// grew a `tests/component/**` suite - and `eslint-core.ts` states that jsdom is MANDATED for that
// directory - while the ESLint block carrying the test-integrity rules stayed scoped to `tests/int` and
// `tests/unit`. The result was a suite the harness runs, mandates an environment for, and ships React
// Testing Library, jest-dom and user-event for, while every `testing-library/*` rule, `no-disabled-tests`,
// `no-commented-out-tests` and the literal-assertion ban passed over it. Measured on one consumer's file
// linted under both paths: twelve findings under `tests/unit`, four under `tests/component`.
//
// A drift nobody compares is a drift nobody notices, so this asserts the joint rather than either side.
// Adding a suite to `vitest.ts` now fails here until the lint block reaches it, which is the failure the
// gap should have produced the first time.
//
// Read through `calculateConfigForFile` rather than from the block's `files` array, for the reason every
// sibling spec reads it that way: flat-config ordering is load-bearing, a later block may narrow what an
// earlier one granted, and only the cascade knows what a path actually resolves to.

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ESLint, type Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
// The build output, not the source, for the reason `vitest-config.spec.ts` states.
import payloadConfig from '../dist/eslint.js'
import libraryConfig from '../dist/eslint-library.js'

// Plugin resolution happens relative to this, and pnpm's strict layout only exposes `eslint-plugin-*` to
// the package that declares them - so a run rooted anywhere else resolves nothing.
const specDirectory: string = path.dirname(fileURLToPath(import.meta.url))
const configPackage: string = path.join(specDirectory, '..')
const configBuild: string = path.join(configPackage, 'dist')

// What `calculateConfigForFile` reports for a rule set to `'error'`: it normalises the word to its
// number, so the assertions below compare against the number rather than against what the config says.
const ERROR: number = 2

// One rule from each half of the block, rather than the whole list. `no-focused-tests` is the integrity
// half and both configs mount the plugin that carries it; `no-container` is the React Testing Library
// half, which only the application config mounts and which is the half the component suite escaped.
const INTEGRITY_RULE: string = 'vitest/no-focused-tests'
const TESTING_LIBRARY_RULE: string = 'testing-library/no-container'

// Ordinary source, where neither rule has any business being on. Without this the properties below would
// hold just as well for a config that turned both rules on everywhere, which would prove nothing.
const SOURCE_FILE: string = 'src/lib/example.ts'

// The directory a component spec must live in, named here so the assertion that the application config
// reaches it does not depend on the glob list still containing one.
const COMPONENT_PATH: string = 'tests/component/example.component.spec.tsx'

/** The part of one collected suite this spec reads. */
interface Suite {
  readonly include?: readonly string[]
}

/** The part of a Vitest config this spec reads. */
interface VitestConfig {
  readonly test?: Suite & { readonly projects?: readonly { readonly test?: Suite }[] }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

// A shape this does not recognise throws rather than yielding an empty list: a spec that silently
// measured nothing would keep reporting green while proving none of the properties below.
const loadConfig = async (modulePath: string): Promise<VitestConfig> => {
  const loaded: unknown = await import(pathToFileURL(modulePath).href)
  const exported: unknown = (loaded as { default?: unknown }).default
  if (!isRecord(exported)) {
    throw new TypeError(`${modulePath} does not default-export a Vitest config`)
  }
  return exported
}

// Loaded at MODULE scope, deliberately, for the reason `vitest-config.spec.ts` states: importing a built
// config pulls in every plugin it declares, and a test body is measured against `testTimeout`.
const SHIPPED_SUITES: VitestConfig = await loadConfig(path.join(configBuild, 'vitest.js'))
const LIBRARY_SUITES: VitestConfig = await loadConfig(path.join(configBuild, 'vitest-library.js'))

// A config declaring projects runs those and never its own root globs, so the root block is the suite
// only when there are no projects. Throwing on neither keeps a renamed key from emptying the list.
const suitesOf = (config: VitestConfig): readonly Suite[] => {
  const projects: readonly { readonly test?: Suite }[] | undefined = config.test?.projects
  if (projects !== undefined) {
    return projects.map((project: { readonly test?: Suite }): Suite => {
      if (project.test === undefined) {
        throw new TypeError('a declared project carries no test block')
      }
      return project.test
    })
  }
  if (config.test === undefined) {
    throw new TypeError('the config carries neither a test block nor projects')
  }
  return [config.test]
}

// One path a glob would collect. `tests/component/**/*.component.spec.tsx` becomes
// `tests/component/example.component.spec.tsx`, which is what the cascade is then asked about. A glob
// this cannot reduce to a concrete path throws rather than being skipped, so a pattern shape nobody
// anticipated fails the spec instead of quietly leaving a suite unchecked.
const representativePath = (glob: string): string => {
  const concrete: string = glob.replaceAll('**/', '').replace('*', 'example')
  if (concrete.includes('*')) {
    throw new TypeError(`${glob} does not reduce to one path`)
  }
  return concrete
}

/** Every path the runner would collect, one per include glob across every suite the config declares. */
const collectedPaths = (config: VitestConfig): readonly string[] => {
  const globs: readonly string[] = suitesOf(config).flatMap(
    (suite: Suite): readonly string[] => suite.include ?? [],
  )
  if (globs.length === 0) {
    throw new TypeError('the config collects nothing')
  }
  return globs.map((glob: string): string => representativePath(glob))
}

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

const severityOf = (setting: unknown): unknown => (Array.isArray(setting) ? setting[0] : setting)

/** What one rule resolves to at each path, keyed by path so a failure names which suite drifted. */
const severitiesAt = async (
  config: readonly Linter.Config[],
  paths: readonly string[],
  rule: string,
): Promise<Readonly<Record<string, unknown>>> =>
  Object.fromEntries(
    await Promise.all(
      paths.map(async (filePath: string): Promise<readonly [string, unknown]> => {
        const rules: Readonly<Record<string, unknown>> = await resolveRules(config, filePath)
        return [filePath, severityOf(rules[rule])]
      }),
    ),
  )

const atEveryPath = (paths: readonly string[], value: unknown): Readonly<Record<string, unknown>> =>
  Object.fromEntries(paths.map((filePath: string): readonly [string, unknown] => [filePath, value]))

describe('every suite the runner collects', () => {
  it('is held to the test-integrity rules by the application configuration', async () => {
    const paths: readonly string[] = collectedPaths(SHIPPED_SUITES)

    expect(await severitiesAt(payloadConfig, paths, INTEGRITY_RULE)).toStrictEqual(
      atEveryPath(paths, ERROR),
    )
  })

  it('is held to the test-integrity rules by the library configuration', async () => {
    const paths: readonly string[] = collectedPaths(LIBRARY_SUITES)

    expect(await severitiesAt(libraryConfig, paths, INTEGRITY_RULE)).toStrictEqual(
      atEveryPath(paths, ERROR),
    )
  })

  // The load-bearing half. Both properties above would hold for a configuration that turned the rule on
  // everywhere, which would make them measure the rule's reach rather than the block's scope.
  it('is the only place those rules reach, so the properties above are not vacuous', async () => {
    const rules: Readonly<Record<string, unknown>> = await resolveRules(payloadConfig, SOURCE_FILE)

    expect(severityOf(rules[INTEGRITY_RULE])).toBeUndefined()
    expect(severityOf(rules[TESTING_LIBRARY_RULE])).toBeUndefined()
  })
})

describe('a component spec', () => {
  // Stated separately from the sweep above because it is the case that was actually wrong, and because
  // the sweep would still pass if the component glob were dropped from the runner instead of added to
  // the linter. The directory is named here rather than derived, so this keeps asking after it.
  it('is held to the React Testing Library rules, which name it in their own comment', async () => {
    const rules: Readonly<Record<string, unknown>> = await resolveRules(
      payloadConfig,
      COMPONENT_PATH,
    )

    expect(severityOf(rules[TESTING_LIBRARY_RULE])).toBe(ERROR)
  })

  it('is held to the test-integrity rules as well, not merely to the user-facing ones', async () => {
    const rules: Readonly<Record<string, unknown>> = await resolveRules(
      payloadConfig,
      COMPONENT_PATH,
    )

    expect(severityOf(rules[INTEGRITY_RULE])).toBe(ERROR)
  })

  it('is collected by a suite, so the directory the rules reach is one the runner runs', () => {
    expect(collectedPaths(SHIPPED_SUITES)).toContain(COMPONENT_PATH)
  })
})
