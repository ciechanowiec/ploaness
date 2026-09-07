import { describe, expect, it } from 'vitest'
import { containsRoute, reachesAxe, type SpecSource } from '../src/axe-coverage.js'

describe('accessibility source evidence', () => {
  it.each([
    String.raw`// await page.waitForURL(/\/profile$/u)`,
    String.raw`/* await page.waitForURL(/\/profile$/u) */`,
  ])('does not restore a route regex from a comment: %s', (source: string) => {
    expect(containsRoute(source, '/profile')).toBe(false)
  })

  it.each([
    '// new AxeBuilder({ page }).analyze()',
    '/* axe.run(document) */',
    'const text = "AxeBuilder"',
  ])('does not accept commented or quoted axe evidence: %s', (source: string) => {
    expect(reachesAxe({ path: 'tests/e2e/profile.ts', source }, [])).toBe(false)
  })

  it('does not borrow an unrelated helper with the same suffix', () => {
    const spec: SpecSource = {
      path: 'tests/e2e/profile.ts',
      source: "import { scan } from '../helpers/a11y'",
    }
    expect(
      reachesAxe(spec, [
        { path: 'src/unrelated/helpers/a11y.ts', source: 'new AxeBuilder({ page }).analyze()' },
      ]),
    ).toBe(false)
  })

  it('ignores a commented helper import', () => {
    const spec: SpecSource = {
      path: 'tests/e2e/profile.ts',
      source: "// import { scan } from '../helpers/a11y'",
    }
    expect(
      reachesAxe(spec, [
        { path: 'tests/helpers/a11y.ts', source: 'new AxeBuilder({ page }).analyze()' },
      ]),
    ).toBe(false)
  })

  it.each(['../helpers/a11y.js', '../helpers/a11y', '../helpers/a11y.ts'])(
    'resolves an imported source helper through %s',
    (specifier: string) => {
      expect(
        reachesAxe(
          { path: 'tests/e2e/profile.ts', source: `import { scan } from '${specifier}'` },
          [{ path: 'tests/helpers/a11y.ts', source: 'new AxeBuilder({ page }).analyze()' }],
        ),
      ).toBe(true)
    },
  )
})
