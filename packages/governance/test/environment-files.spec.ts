import { describe, expect, it } from 'vitest'
import {
  portOf,
  RUN_ENVIRONMENT_FILES,
  runEnvironmentFiles,
  runEnvironmentOverrides,
} from '../src/environment-files.js'

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

describe('portOf', () => {
  it('reads the port a project declared', () => {
    // The setting exists to describe a non-default port, and without this the server was started on the
    // framework's default while the runner waited on the declared one.
    expect(portOf('http://localhost:3100')).toBe('3100')
  })

  it('names no port when the origin carries none', () => {
    expect(portOf('https://example.test')).toBeUndefined()
  })

  it('names no port for an origin it cannot parse', () => {
    expect(portOf('not a url')).toBeUndefined()
  })

  it('reads a port from an origin carrying a path', () => {
    expect(portOf('http://localhost:3000/admin')).toBe('3000')
  })
})

describe('runEnvironmentOverrides', () => {
  it('offers nothing when the project keeps no environment file', () => {
    expect(runEnvironmentOverrides({ DATABASE_URL: 'postgres://real' }, [])).toEqual({})
  })

  it('offers a variable no file and no run would otherwise supply', () => {
    expect(runEnvironmentOverrides({}, [{ BLOB_READ_WRITE_TOKEN: 'from-file' }])).toEqual({
      BLOB_READ_WRITE_TOKEN: 'from-file',
    })
  })

  // The rule the whole function exists for. A spawn merges an override OVER the inherited value, so a
  // file value handed through as an override would beat the CI secret that was there first.
  it('withholds a name the run already carries, so a real variable outranks every file', () => {
    expect(
      runEnvironmentOverrides({ DATABASE_URL: 'postgres://ci' }, [
        { DATABASE_URL: 'postgres://checked-in' },
      ]),
    ).toEqual({})
  })

  // The joint with runEnvironmentFiles: that function's ORDER is this function's precedence, so the
  // two are only correct together.
  it('lets the file named first win a name two files declare', () => {
    expect(
      runEnvironmentOverrides({}, [{ SERVER_URL: 'from-local' }, { SERVER_URL: 'from-env' }]),
    ).toEqual({ SERVER_URL: 'from-local' })
  })

  it('carries the names only one file declares alongside a contested one', () => {
    expect(
      runEnvironmentOverrides({}, [
        { SHARED: 'first', ONLY_LOCAL: 'local' },
        { SHARED: 'second', ONLY_ENV: 'env' },
      ]),
    ).toEqual({ SHARED: 'first', ONLY_LOCAL: 'local', ONLY_ENV: 'env' })
  })

  // A parser reports a name it could not give a value to, and passing that through as `undefined`
  // would set the name to the string "undefined" in the child rather than leaving it unset.
  it('drops a name a file left without a value rather than passing it on', () => {
    expect(runEnvironmentOverrides({}, [{ EMPTY: undefined, KEPT: 'value' }])).toEqual({
      KEPT: 'value',
    })
  })

  // A name the run carries as the empty string is a name the run CARRIES. Reading it as absent is the
  // failure mode that merging the files underneath `process.env` would have reintroduced.
  it('treats a name the run set to the empty string as already carried', () => {
    expect(runEnvironmentOverrides({ FLAG: '' }, [{ FLAG: 'from-file' }])).toEqual({})
  })
})
