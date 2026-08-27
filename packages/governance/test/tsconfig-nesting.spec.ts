// The required `include` is a recursive glob, so at a WORKSPACE ROOT it sweeps every member's sources
// into the root's own project - under the root's `paths`, where a member's `@/*` points somewhere else
// entirely. A real workspace failed `types` at its root on imports that resolve perfectly well inside
// the member that owns them, and no value the project could write would have fixed it: `exclude` is
// dictated exactly, so the root could not name the directories it does not compile.
//
// Deriving it from the member list is what makes the two halves agree: `ploaness init` writes what the
// rule asks for, and neither can name a member the other does not.
import { describe, expect, it } from 'vitest'
import {
  LIBRARY_TSCONFIG_PATHS,
  REQUIRED_TSCONFIG_PATHS,
  tsconfigPathsFor,
} from '../src/wiring-policy.js'

// Read once rather than indexed at each assertion: the field is optional on the shared shape, and
// narrowing it inline is what the formatter kept turning into a non-null assertion.
const REQUIRED_EXCLUDE: readonly string[] = REQUIRED_TSCONFIG_PATHS['exclude'] ?? []
const LIBRARY_EXCLUDE: readonly string[] = LIBRARY_TSCONFIG_PATHS['exclude'] ?? []

describe('tsconfigPathsFor', () => {
  it('is the identity for a member that contains no other member', () => {
    // The single-package proof: every project that exists today takes this branch, so its required
    // tsconfig is byte-identical to the one that shipped.
    expect(tsconfigPathsFor(REQUIRED_TSCONFIG_PATHS, [])).toBe(REQUIRED_TSCONFIG_PATHS)
    expect(tsconfigPathsFor(LIBRARY_TSCONFIG_PATHS, [])).toBe(LIBRARY_TSCONFIG_PATHS)
  })

  it('excludes every member nested inside this one', () => {
    expect(tsconfigPathsFor(LIBRARY_TSCONFIG_PATHS, ['cms', 'fe'])['exclude']).toEqual([
      ...LIBRARY_EXCLUDE,
      'cms',
      'fe',
    ])
  })

  it('leaves the include untouched, because a member still compiles all of its own sources', () => {
    expect(tsconfigPathsFor(LIBRARY_TSCONFIG_PATHS, ['cms'])['include']).toEqual(
      LIBRARY_TSCONFIG_PATHS['include'],
    )
  })

  it('keeps the base exclusions rather than replacing them', () => {
    expect(tsconfigPathsFor(REQUIRED_TSCONFIG_PATHS, ['apps/web'])).toMatchObject({
      exclude: [...REQUIRED_EXCLUDE, 'apps/web'],
    })
  })
})
