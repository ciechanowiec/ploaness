import { describe, expect, it } from 'vitest'
import { RUN_ENVIRONMENT_FILES, runEnvironmentFiles } from '../src/environment-files.js'

// A real (not mocked) isExistingFile backed by a set of known paths - the pure core takes it as a value,
// which is exactly why no test double is needed (see AGENTS.md "no mocks").
const existenceCheckOver =
  (paths: readonly string[]) =>
  (candidate: string): boolean =>
    paths.includes(candidate)

const filesPresent = (paths: readonly string[]): readonly string[] =>
  runEnvironmentFiles(existenceCheckOver(paths))

describe('runEnvironmentFiles', () => {
  it('reads nothing when the project keeps no environment file', () => {
    expect(filesPresent([])).toEqual([])
  })

  it('skips a file the project does not have rather than asking a run to read it', () => {
    expect(filesPresent(['.env'])).toEqual(['.env'])
  })

  // The joint that matters. `process.loadEnvFile` never replaces a value already set, so the order the
  // reads happen in IS the precedence: whichever file is named first wins the variables both declare.
  it('names the untracked override before the tracked file, so the override wins', () => {
    expect(filesPresent(['.env', '.env.local'])).toEqual(['.env.local', '.env'])
  })

  it('offers no file the project did not put there', () => {
    expect(filesPresent(['.env.production', '.env.example'])).toEqual([])
  })

  it('reads every declared file when the project keeps all of them', () => {
    expect(filesPresent(RUN_ENVIRONMENT_FILES)).toEqual(RUN_ENVIRONMENT_FILES)
  })
})
