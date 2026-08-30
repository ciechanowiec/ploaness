import { describe, expect, it } from 'vitest'
import {
  type DeclaredAdminView,
  findDeclaredAdminViews,
  findUnscannedAdminViews,
  type SpecSource,
} from '../src/admin-view-coverage.js'

const CONFIG: string = `
export default buildConfig({
  admin: {
    components: {
      afterNavLinks: ['/components/CalendarNavLink#CalendarNavLink'],
      views: {
        calendar: { Component: '/views/Calendar#CalendarView', exact: true, path: '/calendar' },
      },
    },
  },
})
`

const pathsOf = (source: string): readonly string[] =>
  findDeclaredAdminViews(source).map((view: DeclaredAdminView) => view.path)

const rulesOf = (
  views: readonly DeclaredAdminView[],
  specs: readonly SpecSource[],
  everyFile: readonly SpecSource[] = specs,
): readonly string[] =>
  findUnscannedAdminViews(views, specs, everyFile).map((violation) => violation.rule)

const CALENDAR: readonly DeclaredAdminView[] = [{ path: '/calendar', line: 1 }]

describe('which declarations are read as a custom admin view', () => {
  it('finds a view declared on the root admin config', () => {
    expect(pathsOf(CONFIG)).toEqual(['/calendar'])
  })

  it('finds every view in one block', () => {
    expect(
      pathsOf(`admin: { components: { views: {
        a: { path: '/one' }, b: { path: '/two' },
      } } }`),
    ).toEqual(['/one', '/two'])
  })

  it('finds a view declared on a collection', () => {
    expect(
      pathsOf(`const Bookings = { admin: { components: { views: {
        board: { path: '/board' },
      } } } }`),
    ).toEqual(['/board'])
  })

  it('reads a double-quoted path', () => {
    expect(pathsOf('components: { views: { a: { path: "/one" } } }')).toEqual(['/one'])
  })

  it('reports the line the path is declared on', () => {
    expect(findDeclaredAdminViews(CONFIG)[0]?.line).toBe(7)
  })

  it('says nothing about a config with no custom views', () => {
    expect(pathsOf('export default buildConfig({ admin: { user: "users" } })')).toEqual([])
  })

  // The nesting is what tells Payload's vocabulary apart from a project's own. A `views` key somewhere
  // else is a name this project chose, not a route the sweep will miss.
  it('ignores a views block that is not inside a components block', () => {
    expect(pathsOf("const state = { views: { a: { path: '/one' } } }")).toEqual([])
  })

  // Fail open on source that cannot be parsed, as every other reader in this package does: a block
  // nobody closed makes the answer undecidable, and guessing at one would report views a project does
  // not serve.
  it('says nothing about a block that is never closed', () => {
    expect(pathsOf("admin: { components: { views: { a: { path: '/one' }")).toEqual([])
  })

  it('ignores a declaration that is only written in a comment', () => {
    expect(pathsOf("// components: { views: { a: { path: '/one' } } }")).toEqual([])
  })

  // A brace inside a string used to close the block early, which hid every view declared after it.
  it('is not fooled by a brace inside a string', () => {
    expect(
      pathsOf(`components: { views: {
        a: { Component: 'x}y', path: '/one' },
      } }`),
    ).toEqual(['/one'])
  })
})

describe('whether a declared view is scanned', () => {
  it('accepts a spec that drives the route and runs axe itself', () => {
    expect(
      rulesOf(CALENDAR, [
        { path: 'tests/e2e/calendar.e2e.spec.ts', source: "goto('/calendar'); new AxeBuilder()" },
      ]),
    ).toEqual([])
  })

  // The ordinary arrangement: the spec drives the route and the scan lives in a shared helper.
  it('accepts a spec that reaches axe through a helper it imports', () => {
    const spec: SpecSource = {
      path: 'tests/e2e/calendar.e2e.spec.ts',
      source: "import { scanWithin } from '../helpers/accessibility'\ngoto('/calendar')",
    }
    const helper: SpecSource = {
      path: 'tests/helpers/accessibility.ts',
      source: "import AxeBuilder from '@axe-core/playwright'",
    }

    expect(rulesOf(CALENDAR, [spec], [spec, helper])).toEqual([])
  })
})

describe('what an unscanned view is reported as', () => {
  it('reports a view no test drives at all', () => {
    expect(
      rulesOf(CALENDAR, [{ path: 'tests/e2e/other.e2e.spec.ts', source: "goto('/admin')" }]),
    ).toEqual(['admin-view-undriven'])
  })

  // The failure this whole rule exists for: the view is exercised, so it looks covered, and nothing
  // has ever measured its contrast or read its landmarks.
  it('reports a view a test drives but nothing scans', () => {
    expect(
      rulesOf(CALENDAR, [
        { path: 'tests/e2e/calendar.e2e.spec.ts', source: "goto('/calendar'); expect(1).toBe(1)" },
      ]),
    ).toEqual(['admin-view-unscanned'])
  })

  // A route is a prefix, so a bare substring search would let the wrong spec answer for it.
  it('does not let a spec for a longer route answer for a shorter one', () => {
    expect(
      rulesOf(CALENDAR, [
        {
          path: 'tests/e2e/archive.e2e.spec.ts',
          source: "goto('/calendar-archive'); new AxeBuilder()",
        },
      ]),
    ).toEqual(['admin-view-undriven'])
  })
})

describe('what must not be mistaken for a test driving the route', () => {
  // The false PASS this rule cannot be allowed to have. An import specifier is a path, so
  // `@/lib/calendar/interval` contains `/calendar`; a spec that merely imports a module of that name
  // and also pulls in the shared axe helper would otherwise answer for a view nothing scans.
  it('does not read an import specifier as a route the spec drives', () => {
    expect(
      rulesOf(CALENDAR, [
        {
          path: 'tests/unit/interval.unit.spec.ts',
          source: "import { widen } from '@/lib/calendar/interval'\nimport 'axe.run'",
        },
      ]),
    ).toEqual(['admin-view-undriven'])
  })

  it('does not read a comment as a route the spec drives', () => {
    expect(
      rulesOf(CALENDAR, [
        {
          path: 'tests/e2e/other.e2e.spec.ts',
          source: '// one day, scan /calendar\nnew AxeBuilder()',
        },
      ]),
    ).toEqual(['admin-view-undriven'])
  })

  it('judges every declared view on its own', () => {
    expect(
      rulesOf(
        [
          { path: '/calendar', line: 1 },
          { path: '/board', line: 2 },
        ],
        [{ path: 'tests/e2e/calendar.e2e.spec.ts', source: "goto('/calendar'); new AxeBuilder()" }],
      ),
    ).toEqual(['admin-view-undriven'])
  })

  it('says nothing about a project that declares no custom views', () => {
    expect(rulesOf([], [])).toEqual([])
  })
})
