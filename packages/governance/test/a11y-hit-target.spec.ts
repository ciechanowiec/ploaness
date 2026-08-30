import { describe, expect, it } from 'vitest'
import {
  classifyHitTarget,
  type HitTargetClassification,
  type HitTargetProbe,
} from '../src/a11y-hit-target.js'

const probe = (overrides: Partial<HitTargetProbe>): HitTargetProbe => ({
  width: 120,
  height: 40,
  clipPath: 'none',
  clip: 'auto',
  ownsCentrePoint: true,
  ...overrides,
})

describe('classifyHitTarget', () => {
  it('calls an ordinary control hoverable', () => {
    expect(classifyHitTarget(probe({})).verdict).toBe('hoverable')
  })

  it('calls the standard clip-path skip link visually hidden', () => {
    const verdict: HitTargetClassification = classifyHitTarget(
      probe({ clipPath: 'inset(50%)', ownsCentrePoint: false }),
    )
    expect(verdict.verdict).toBe('visually-hidden')
    expect(verdict.reason).toContain('no painted pixels')
  })

  it('calls the legacy 1px clip-rect pattern visually hidden', () => {
    expect(
      classifyHitTarget(
        probe({
          width: 1,
          height: 1,
          clip: 'rect(0px, 0px, 0px, 0px)',
          ownsCentrePoint: false,
        }),
      ).verdict,
    ).toBe('visually-hidden')
  })

  it('calls a zero-area box visually hidden', () => {
    expect(classifyHitTarget(probe({ width: 0, ownsCentrePoint: false })).verdict).toBe(
      'visually-hidden',
    )
  })

  it('calls a painted control that something covers obscured, not hidden', () => {
    const verdict: HitTargetClassification = classifyHitTarget(probe({ ownsCentrePoint: false }))
    expect(verdict.verdict).toBe('obscured')
    expect(verdict.reason).toContain('defect in the page')
  })
})

// The cases that decide whether the skip is narrow enough to be safe. A clip is an ordinary decorative
// tool as well as a hiding technique, and a classifier that could not tell them apart would skip the
// hover check on real controls - which is the failure mode worth guarding, since it is silent.
describe('classifyHitTarget on styling that only looks hidden', () => {
  it('does not mistake a decorative clip-path on a real button for a hiding technique', () => {
    expect(
      classifyHitTarget(probe({ clipPath: 'polygon(0% 0%, 100% 0%, 50% 100%)' })).verdict,
    ).toBe('hoverable')
    expect(
      classifyHitTarget(
        probe({ clipPath: 'polygon(0% 0%, 100% 0%, 50% 100%)', ownsCentrePoint: false }),
      ).verdict,
    ).toBe('obscured')
  })

  it('treats a control that owns its centre point as hoverable whatever its styling', () => {
    expect(classifyHitTarget(probe({ clipPath: 'inset(50%)' })).verdict).toBe('hoverable')
  })

  it('reads inset(100%) and circle(0) as the same intent as inset(50%)', () => {
    expect(
      classifyHitTarget(probe({ clipPath: 'inset(100%)', ownsCentrePoint: false })).verdict,
    ).toBe('visually-hidden')
    expect(
      classifyHitTarget(probe({ clipPath: 'circle(0px at 50% 50%)', ownsCentrePoint: false }))
        .verdict,
    ).toBe('visually-hidden')
  })

  it('does not read a partial inset as a hiding technique', () => {
    expect(
      classifyHitTarget(probe({ clipPath: 'inset(10% 20%)', ownsCentrePoint: false })).verdict,
    ).toBe('obscured')
  })
})
