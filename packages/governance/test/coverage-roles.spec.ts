import { describe, expect, it } from 'vitest'
import { matchesGlob } from '../src/file-roles.js'
import { COVERAGE_INCLUDE, readSettings } from '../src/settings.js'

const isMeasured = (file: string): boolean =>
  COVERAGE_INCLUDE.some((pattern: string): boolean => matchesGlob(pattern, file)) &&
  !readSettings({}).coverageExclude.some((pattern: string): boolean => matchesGlob(pattern, file))

describe('coverage follows a module role within the application', () => {
  it('measures ordinary helpers wherever they are colocated', () => {
    for (const file of [
      'src/lib/price.ts',
      'src/app/price.ts',
      'src/app/(frontend)/[slug]/_lib/price.ts',
      'src/app/(payload)/admin/price.ts',
      'src/app/api/items/route-helper.ts',
      'src/app/page/helper.ts',
      'scripts/price.ts',
    ]) {
      expect(isMeasured(file), file).toBe(true)
    }
  })

  it('keeps framework entry points and generated or declaration roles excluded', () => {
    for (const file of [
      'src/app/page.ts',
      'src/app/(frontend)/[slug]/page.ts',
      'src/app/(payload)/api/[...slug]/route.ts',
      'src/app/(frontend)/layout.ts',
      'src/app/template.ts',
      'src/app/loading.ts',
      'src/app/error.ts',
      'src/app/global-error.ts',
      'src/app/not-found.ts',
      'src/app/global-not-found.ts',
      'src/app/@slot/default.ts',
      'src/app/forbidden.ts',
      'src/app/unauthorized.ts',
      'src/app/robots.ts',
      'src/app/products/sitemap.ts',
      'src/app/manifest.ts',
      'src/app/icon.ts',
      'src/app/apple-icon.ts',
      'src/app/opengraph-image.ts',
      'src/app/twitter-image.ts',
      'src/payload-types.ts',
      'src/types.d.ts',
      'src/components/Card.tsx',
    ]) {
      expect(isMeasured(file), file).toBe(false)
    }
    expect(isMeasured('src/lib/route.ts')).toBe(true)
  })
})
