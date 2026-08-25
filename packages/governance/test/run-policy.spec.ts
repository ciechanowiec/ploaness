import { describe, expect, it } from 'vitest'
import { endsRun, type RunPoint } from '../src/run-policy.js'

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
