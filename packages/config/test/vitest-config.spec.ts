// The joints between the two Vitest configs and the shared layer they both read.
//
// Both configs carry the two determinism mechanisms - the network guard, installed by a setup file, and
// the shuffled order, declared by a sequence block. Neither config may state either one itself: a second
// statement of the seed would drift silently, because nothing fails when two numbers that must be equal
// stop being equal.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DETERMINISTIC_SEQUENCE, harnessSetupFile } from '../vitest-core.js'

/** The part of a Vitest config these assertions read. */
interface VitestConfig {
  readonly test?: {
    readonly setupFiles?: readonly string[]
    readonly sequence?: unknown
  }
}

const specDirectory: string = path.dirname(fileURLToPath(import.meta.url))
const configPackage: string = path.join(specDirectory, '..')
const workspaceRoot: string = path.join(configPackage, '..', '..')

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

const shipped = (): Promise<VitestConfig> => loadConfig(path.join(configPackage, 'vitest.js'))

const workspace = (): Promise<VitestConfig> =>
  loadConfig(path.join(workspaceRoot, 'vitest.config.mts'))

describe('the harness setup file', () => {
  it('exists on disk, so a project resolving it meets a guard rather than an error', () => {
    expect(existsSync(harnessSetupFile())).toBe(true)
  })

  it('leads the setup files of the shipped config, before any the project wrote', async () => {
    const config: VitestConfig = await shipped()
    expect(config.test?.setupFiles?.[0]).toBe(harnessSetupFile())
  })

  it('leads the setup files of this repository, which runs what it publishes', async () => {
    const config: VitestConfig = await workspace()
    expect(config.test?.setupFiles?.[0]).toBe(harnessSetupFile())
  })
})

describe('the sequence block', () => {
  it('is the shared one in the shipped config, not a second statement of it', async () => {
    const config: VitestConfig = await shipped()
    expect(config.test?.sequence).toBe(DETERMINISTIC_SEQUENCE)
  })

  it('is the shared one in this repository too, so the two cannot drift apart', async () => {
    const config: VitestConfig = await workspace()
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
