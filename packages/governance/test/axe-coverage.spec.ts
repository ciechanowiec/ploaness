import { describe, expect, it } from 'vitest'
import {
  containsBuiltRoute,
  containsRoute,
  reachesAxe,
  type SpecSource,
} from '../src/axe-coverage.js'

// The helpers two coverage rules share. What is worth stating here is every way a specification can
// look as though it drives a route without driving it: the false pass is the failure these rules
// cannot be allowed to have, because it reports coverage a page does not have.

// A fixture whose whole point is to CONTAIN a template placeholder cannot be written as one: a plain
// string holding the opening pair reads as a placeholder somebody forgot to interpolate, and the lint
// pass is right to say so. The pair is assembled from its halves instead.
const DOLLAR: string = '$'
const HOLE: string = `${DOLLAR}{`

const specOf = (source: string): SpecSource => ({ path: 'tests/e2e/thing.e2e.spec.ts', source })

describe('whether a specification names a route', () => {
  it('finds a route the specification navigates to', () => {
    expect(containsRoute("await page.goto('/profile')", '/profile')).toBe(true)
  })

  it('finds a route written inside a regular expression', () => {
    const source: string = String.raw`await page.waitForURL(/\/welcome$/u)`
    expect(containsRoute(source, '/welcome')).toBe(true)
  })

  it('does not let a longer route answer for a shorter one', () => {
    expect(containsRoute("await page.goto('/profile-settings')", '/profile')).toBe(false)
  })

  it('does not read an import specifier as a route', () => {
    expect(containsRoute("import { thing } from '@/lib/profile/reader'", '/profile')).toBe(false)
  })

  it('does not read a route named in a comment', () => {
    expect(containsRoute('// /profile is covered elsewhere', '/profile')).toBe(false)
  })

  it('says nothing about a specification that mentions no route at all', () => {
    expect(containsRoute('expect(1 + 1).toBe(2)', '/profile')).toBe(false)
  })
})

describe('whether a specification builds an address below a route', () => {
  it('finds a template that interpolates the rest of the address', () => {
    const source: string = `await page.goto(\`/play/${HOLE}String(gameId)}\`)`
    expect(containsBuiltRoute(source, '/play')).toBe(true)
  })

  // The whole reason this is not `containsRoute` on the prefix. A dynamic route names a family of
  // pages, and a specification that visits the family's parent has scanned none of them.
  it('is not satisfied by a specification that only visits the prefix itself', () => {
    expect(containsBuiltRoute("await page.goto('/play')", '/play')).toBe(false)
  })

  it('is not satisfied by another static page beneath the prefix', () => {
    expect(containsBuiltRoute("await page.goto('/play/rules')", '/play')).toBe(false)
  })

  it('reads a route whose first segment is dynamic, whose prefix is the root', () => {
    expect(containsBuiltRoute(`await page.goto(\`/${HOLE}slug}\`)`, '/')).toBe(true)
  })
})

describe('whether a specification reaches axe', () => {
  it('accepts one that builds a scan itself', () => {
    const spec: SpecSource = specOf('const scan = await new AxeBuilder({ page }).analyze()')
    expect(reachesAxe(spec, [spec])).toBe(true)
  })

  it('accepts one that imports the scan from a helper beside it', () => {
    const spec: SpecSource = specOf("import { scan } from '../helpers/accessibility'")
    const helper: SpecSource = {
      path: 'tests/helpers/accessibility.ts',
      source: 'export const scan = async () => new AxeBuilder({ page }).analyze()',
    }
    expect(reachesAxe(spec, [spec, helper])).toBe(true)
  })

  it('refuses one that drives a page and never scans it', () => {
    const spec: SpecSource = specOf("await page.goto('/profile')")
    expect(reachesAxe(spec, [spec])).toBe(false)
  })

  // One hop, deliberately: a chain deeper than that is a project hiding its own scan from itself.
  it('does not follow a second hop to find the scan', () => {
    const spec: SpecSource = specOf("import { drive } from '../helpers/drive'")
    const middle: SpecSource = {
      path: 'tests/helpers/drive.ts',
      source: "import { scan } from './accessibility'",
    }
    const helper: SpecSource = {
      path: 'tests/helpers/accessibility.ts',
      source: 'export const scan = () => new AxeBuilder({})',
    }
    expect(reachesAxe(spec, [spec, middle, helper])).toBe(false)
  })
})
