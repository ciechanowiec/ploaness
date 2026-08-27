import { describe, expect, it } from 'vitest'
import { carriesSourceCode, endsRun, type RunPoint } from '../src/run-policy.js'

const point = (overrides: Partial<RunPoint> = {}): RunPoint => ({
  isFailure: false,
  isPrecondition: false,
  isEnforced: true,
  ...overrides,
})

describe('endsRun', () => {
  it('carries on after a gate that passed', () => {
    expect(endsRun(point())).toBe(false)
  })

  it('stops an enforcing run at the first failure', () => {
    expect(endsRun(point({ isFailure: true }))).toBe(true)
  })

  // The whole point of the mode: a project adopting the harness sees the size of the job in one run
  // rather than learning it one finding at a time.
  it('carries a report-only run past a failure', () => {
    expect(endsRun(point({ isFailure: true, isEnforced: false }))).toBe(false)
  })

  // Below a failing precondition there is nothing to report: ploaness either may not judge this project
  // or cannot tell whether what it is judging is what it thinks.
  it('stops a report-only run at a failing precondition', () => {
    expect(endsRun(point({ isFailure: true, isEnforced: false, isPrecondition: true }))).toBe(true)
  })

  it('does not stop at a precondition that passed', () => {
    expect(endsRun(point({ isPrecondition: true, isEnforced: false }))).toBe(false)
  })
})

const isTypeScript = (filePath: string): boolean => filePath.endsWith('.ts')

describe('carriesSourceCode', () => {
  const Roots: readonly string[] = ['src', 'tests', 'scripts']

  it('finds source under a declared root', () => {
    expect(carriesSourceCode(['src/index.ts'], Roots, isTypeScript)).toBe(true)
  })

  it('reports none for a package holding only a manifest', () => {
    // The workspace root is a member because it owns the scripts a run is invoked through, and it may
    // hold nothing else. A runner started there would fail on an empty include.
    expect(carriesSourceCode(['package.json', 'README.md'], Roots, isTypeScript)).toBe(false)
  })

  it('ignores code outside every declared root', () => {
    expect(carriesSourceCode(['vendor/thing.ts'], Roots, isTypeScript)).toBe(false)
  })

  it('ignores a non-code file inside a root', () => {
    expect(carriesSourceCode(['src/logo.svg'], Roots, isTypeScript)).toBe(false)
  })

  it('does not mistake a prefix for a directory', () => {
    expect(carriesSourceCode(['srcery/index.ts'], Roots, isTypeScript)).toBe(false)
  })
})
