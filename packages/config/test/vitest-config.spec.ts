// The joints between the two Vitest configs and the shared layer they both read.
//
// Both configs carry the two determinism mechanisms - the network guard, installed by a setup file, and
// the shuffled order, declared by a sequence block. Neither config may state either one itself: a second
// statement of the seed would drift silently, because nothing fails when two numbers that must be equal
// stop being equal.
//
// Each property below is asserted of EVERY suite rather than of the config object, because the shipped
// config splits into per-environment projects and a project inherits nothing from the root it is not
// given. A guard that held only for the suite somebody remembered is not a guard.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
// The build output, not the source, and the identity assertions below are the reason. A spec that
// imported `../src/vitest-core.ts` would hold a second module instance of the shared layer, so `toBe`
// would compare two structurally identical objects and fail - and `harnessSetupFile()` resolves against
// its OWN `import.meta.url`, which from `src` names a `vitest-setup.js` that exists only in `dist`.
// Reading the artefact keeps both halves of each assertion on the module a consumer actually loads.
import { DETERMINISTIC_SEQUENCE, harnessSetupFile, testReporters } from '../dist/vitest-core.js'

/** The part of one collected suite these assertions read. */
interface Suite {
  readonly environment?: string
  readonly include?: readonly string[]
  readonly setupFiles?: readonly string[]
  readonly sequence?: unknown
  readonly fileParallelism?: boolean
}

/** The part of a Vitest config these assertions read. */
interface VitestConfig {
  readonly test?: Suite & {
    readonly projects?: readonly { readonly test?: Suite }[]
    readonly reporters?: readonly unknown[]
  }
}

const specDirectory: string = path.dirname(fileURLToPath(import.meta.url))
const configPackage: string = path.join(specDirectory, '..')
const configBuild: string = path.join(configPackage, 'dist')
const workspaceRoot: string = path.join(configPackage, '..', '..')

// The glob that names an integration spec. Read from the config rather than compared against it: this
// spec asks which suite collects those files, and has nothing to say if none does.
const INTEGRATION_GLOB: string = 'tests/int/'

// A shape this does not recognise throws rather than yielding an empty object: a spec that silently
// measured nothing would keep reporting green while proving none of the properties below.
const loadConfig = async (modulePath: string): Promise<VitestConfig> => {
  const loaded: unknown = await import(pathToFileURL(modulePath).href)
  const exported: unknown = (loaded as { default?: unknown }).default
  if (typeof exported !== 'object' || exported === null) {
    throw new TypeError(`${modulePath} does not default-export a Vitest config`)
  }
  return exported
}

// Loaded at MODULE scope, deliberately. Importing a built config pulls in every plugin it declares and
// costs about a second cold - and a test body is measured against `testTimeout`, so awaiting it there
// made the verdict depend on how busy the machine was. One run of `pnpm run verify` failed on that
// clock rather than on the rule, having passed moments earlier in isolation. Module evaluation carries
// no such clock, and a spec that measures a rule should not also be measuring an import.
const SHIPPED: VitestConfig = await loadConfig(path.join(configBuild, 'vitest.js'))
const WORKSPACE: VitestConfig = await loadConfig(path.join(workspaceRoot, 'vitest.config.mts'))

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

const shippedSuites = (): readonly Suite[] => suitesOf(SHIPPED)

const coversDirectory = (suite: Suite, fragment: string): boolean =>
  (suite.include ?? []).some((glob: string): boolean => glob.includes(fragment))

describe('the harness setup file', () => {
  it('exists on disk, so a project resolving it meets a guard rather than an error', () => {
    expect(existsSync(harnessSetupFile())).toBe(true)
  })

  it('leads the setup files of every shipped suite, before any the project wrote', () => {
    const suites: readonly Suite[] = shippedSuites()
    expect(suites.length).toBeGreaterThan(0)
    for (const suite of suites) {
      expect(suite.setupFiles?.[0]).toBe(harnessSetupFile())
    }
  })

  it('leads the setup files of this repository, which runs what it publishes', () => {
    const config: VitestConfig = WORKSPACE
    expect(config.test?.setupFiles?.[0]).toBe(harnessSetupFile())
  })
})

describe('the sequence block', () => {
  it('is the shared one in every shipped suite, not a second statement of it', () => {
    const suites: readonly Suite[] = shippedSuites()
    expect(suites.length).toBeGreaterThan(0)
    for (const suite of suites) {
      expect(suite.sequence).toBe(DETERMINISTIC_SEQUENCE)
    }
  })

  it('is the shared one in this repository too, so the two cannot drift apart', () => {
    const config: VitestConfig = WORKSPACE
    expect(config.test?.sequence).toBe(DETERMINISTIC_SEQUENCE)
  })

  // Vitest's own default here is the wall clock, which would make the suite report differently on two
  // runs of an unchanged repository - the one thing a check may never do.
  it('pins the seed, so shuffling stays deterministic', () => {
    expect(typeof DETERMINISTIC_SEQUENCE.seed).toBe('number')
  })

  it('shuffles both the files and the tests within them', () => {
    expect(DETERMINISTIC_SEQUENCE.shuffle).toEqual({ files: true, tests: true })
  })

  // Without this the runner loads setup files in parallel, and the guard being first would be a race
  // rather than an ordering.
  it('loads the setup files in the order they are listed', () => {
    expect(DETERMINISTIC_SEQUENCE.setupFiles).toBe('list')
  })
})

describe('the environment a suite runs in', () => {
  // jsdom installs its own realm's globals, typed-array constructors included, so a Node `Buffer` fails
  // `instanceof Uint8Array` in any library that guards its input that way. Payload's upload pipeline
  // does, through `file-type`, and reports the TypeError as the project's own upload allowlist
  // rejecting a valid image - so this held every consumer's integration suite hostage to a realm it had
  // no reason to be in.
  it('is node wherever integration specs are collected, which boot a server and not a browser', () => {
    const suites: readonly Suite[] = shippedSuites()
    const integration: readonly Suite[] = suites.filter((suite: Suite): boolean =>
      coversDirectory(suite, INTEGRATION_GLOB),
    )
    expect(integration.length).toBeGreaterThan(0)
    for (const suite of integration) {
      expect(suite.environment).toBe('node')
    }
  })

  // The other half of the same split: ploaness pins and ships React Testing Library, jest-dom and
  // user-event, which need a DOM. Moving the integration specs out must not take the realm away from
  // the specs that were the reason for shipping it.
  it('is jsdom wherever component specs are collected, which is what that stack is for', () => {
    const suites: readonly Suite[] = shippedSuites()
    const component: readonly Suite[] = suites.filter((suite: Suite): boolean =>
      coversDirectory(suite, 'tests/component/'),
    )
    expect(component.length).toBeGreaterThan(0)
    for (const suite of component) {
      expect(suite.environment).toBe('jsdom')
    }
  })

  // Vitest collapses the suites into one serial group only when every one of them asks for a single
  // worker. A suite that omitted this would run alongside the others, and the Payload boots inside it
  // would race the others for the single ephemeral database the test command created.
  it('runs its files one at a time, in every shipped suite', () => {
    const suites: readonly Suite[] = shippedSuites()
    expect(suites.length).toBeGreaterThan(0)
    for (const suite of suites) {
      expect(suite.fileParallelism).toBe(false)
    }
  })
})

// Vitest appends its own `github-actions` reporter whenever `GITHUB_ACTIONS` is set and the reporter list
// is EMPTY, and that reporter writes a scoreboard into the workflow's job summary. A verification runs
// suites that are MEANT to fail, so the scoreboard reported failures at the top of a green run. What
// suppresses the append is declaring the list at all - which makes an ABSENT list, rather than a wrong
// one, the thing to guard: the entries themselves are literal types the compiler already refuses to
// widen, so a summary re-enabled by hand does not compile.
describe('the reporter list', () => {
  it('is declared by the shipped config, so the runner appends no reporter of its own', () => {
    const config: VitestConfig = SHIPPED
    expect(config.test?.reporters).toEqual(testReporters())
  })

  it('is declared by this repository too, from the same source, so the two cannot drift', () => {
    const config: VitestConfig = WORKSPACE
    expect(config.test?.reporters).toEqual(testReporters())
  })
})
