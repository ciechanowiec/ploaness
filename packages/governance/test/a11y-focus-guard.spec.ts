import { describe, expect, it } from 'vitest'
import { type FocusArrival, isFocusGuard } from '../src/a11y-focus-guard.js'

const REDIRECTED: FocusArrival = { staysInSubtree: false, restsOnBody: false, restsHidden: false }

describe('isFocusGuard', () => {
  it('clears a hidden span that passes focus on to the dialog it guards', () => {
    expect(isFocusGuard([REDIRECTED])).toBe(true)
  })

  it('clears a subtree only when every element in it passes focus on', () => {
    expect(isFocusGuard([REDIRECTED, REDIRECTED])).toBe(true)
    expect(isFocusGuard([REDIRECTED, { ...REDIRECTED, staysInSubtree: true }])).toBe(false)
  })

  it('reports a hidden element that keeps the focus it receives', () => {
    expect(isFocusGuard([{ ...REDIRECTED, staysInSubtree: true }])).toBe(false)
  })

  it('reports focus dropped on the body, where a keyboard user loses their place', () => {
    expect(isFocusGuard([{ ...REDIRECTED, restsOnBody: true }])).toBe(false)
  })

  it('reports focus passed on to another hidden element', () => {
    expect(isFocusGuard([{ ...REDIRECTED, restsHidden: true }])).toBe(false)
  })

  it('reports a subtree with nothing the probe could focus', () => {
    expect(isFocusGuard([])).toBe(false)
  })
})
