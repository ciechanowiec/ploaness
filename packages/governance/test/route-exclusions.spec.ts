import { describe, expect, it } from 'vitest'
import { DEFAULT_SKIPPED_ROUTES, isSkippedRoute } from '../src/route-exclusions.js'
import { readSettings, type Settings } from '../src/settings.js'
import { readMemberSettings } from '../src/settings-layering.js'

const isExcluded = (route: string, settings: Settings): boolean =>
  isSkippedRoute(route, settings.accessibilitySkipRoutes, settings.accessibilityCustomSkipRoutes)

describe('route exclusion provenance', () => {
  it.each(['/api', '/api/', '/api/posts', '/admin', '/admin/users'])(
    'excludes the built-in path %s',
    (route: string) => {
      expect(isExcluded(route, readSettings({}))).toBe(true)
    },
  )

  it.each(['/apiary', '/api-documentation', '/administration-help', '/about'])(
    'keeps the public route %s in scope',
    (route: string) => {
      expect(isExcluded(route, readSettings({}))).toBe(false)
    },
  )

  it('retains explicit prefix semantics when a project repeats a built-in path', () => {
    const settings: Settings = readSettings({
      ploaness: { accessibilitySkipRoutes: [{ pattern: '/api', reason: 'private previews' }] },
    })
    expect(isExcluded('/apiary', settings)).toBe(true)
    expect(isExcluded('/administration-help', settings)).toBe(false)
  })

  it('inherits explicit prefixes while the declaration remains owned by the root', () => {
    const settings: Settings = readMemberSettings(
      { accessibilitySkipRoutes: [{ pattern: '/admin', reason: 'private administration pages' }] },
      {},
    )
    expect(settings.declaredExclusions).toEqual([])
    expect(isExcluded('/administration-help', settings)).toBe(true)
  })

  it('does not honour a malformed project declaration', () => {
    expect(isExcluded('/apiary', readSettings({ ploaness: { accessibilitySkipRoutes: ['/api'] } }))).toBe(false)
  })

  it('preserves custom prefixes supplied through the legacy combined list', () => {
    expect(isSkippedRoute('/previewing', [...DEFAULT_SKIPPED_ROUTES, '/preview'])).toBe(true)
    expect(isSkippedRoute('/apiary', DEFAULT_SKIPPED_ROUTES)).toBe(false)
  })

  it('honours an empty exclusion list', () => {
    expect(isSkippedRoute('/api/posts', [])).toBe(false)
  })
})
