import micromatch from 'micromatch'
import { describe, expect, it } from 'vitest'
import {
  coverageBoundaries,
  coverageCandidates,
  coverageIncludes,
  coverageOwnedFiles,
  isCoverageCandidate,
} from '../src/coverage-policy.js'
import { readSettings } from '../src/settings.js'
import { readMemberSettings } from '../src/settings-layering.js'

const isMeasured = (file: string, roots: readonly string[]): boolean => isCoverageCandidate(file, roots)

describe('coverage follows the member source roots', () => {
  it.each(['domain|logic', 'domain(legacy)', 'domain[model]', 'domain"quoted"', 'domain!private'])(
    'treats a declared root as a literal directory: %s',
    (root: string) => {
      const file: string = `${root}/value.ts`
      expect(micromatch.isMatch(file, [...coverageIncludes([root])])).toBe(true)
      expect(isCoverageCandidate(file, [root])).toBe(true)
    },
  )

  it.each(['', '../outside', '..', '/absolute'])('refuses a source root outside the member: %s', (root: string) => {
    expect(() => coverageIncludes([root])).toThrow('ploaness.sourceRoots')
  })

  it('confines a nested member boundary without treating its name as a pattern', () => {
    const files: readonly string[] = ['packages/ui(src)/value.ts', 'packages/ui-src/value.ts', 'value.ts']
    expect(coverageOwnedFiles(files, ['packages/ui(src)'])).toEqual(['packages/ui-src/value.ts', 'value.ts'])
    const exclusions: readonly string[] = coverageBoundaries(['packages/ui(src)'])
    expect(micromatch.isMatch(files[0] ?? '', [...exclusions])).toBe(true)
    expect(micromatch.isMatch(files[1] ?? '', [...exclusions])).toBe(false)
  })
  it('selects owned executable files without counting colocated tests as coverage evidence', () => {
    expect(
      coverageCandidates(
        ['domain/value.mts', 'domain/value.spec.ts', 'domain/value.test.cts', 'nested/domain/value.ts', 'notes.txt'],
        ['.'],
        ['nested'],
      ),
    ).toEqual(['domain/value.mts'])
  })
  it.each(['ts', 'mts', 'cts'])('measures an unimported %s module in a custom directory', (extension: string) => {
    const settings: ReturnType<typeof readSettings> = readSettings({ ploaness: { sourceRoots: ['domain'] } })
    expect(isMeasured(`domain/uncovered.${extension}`, settings.sourceRoots)).toBe(true)
  })

  it('normalizes trailing slashes and does not duplicate roots', () => {
    expect(coverageIncludes(['domain/', 'domain'])).toEqual(coverageIncludes(['domain']))
    expect(isMeasured('domain/value.ts', ['domain/'])).toBe(true)
  })

  it('keeps components, declarations, and the test tree outside unit coverage', () => {
    for (const file of [
      'domain/Card.tsx',
      'domain/types.d.ts',
      'domain/types.d.mts',
      'domain/types.d.cts',
      'tests/helper.ts',
    ]) {
      expect(isMeasured(file, ['domain', 'tests', '.']), file).toBe(false)
    }
  })

  it('measures authored modules when the member declares its root directory', () => {
    expect(isMeasured('value.mts', ['.'])).toBe(true)
  })

  it('inherits repository roots without adopting a sibling member declaration', () => {
    const own: ReturnType<typeof readMemberSettings> = readMemberSettings(
      { sourceRoots: ['shared'] },
      { sourceRoots: ['domain'] },
    )
    const sibling: ReturnType<typeof readMemberSettings> = readMemberSettings(
      { sourceRoots: ['shared'] },
      { sourceRoots: ['sibling'] },
    )
    expect(isMeasured('domain/value.ts', own.sourceRoots)).toBe(true)
    expect(isMeasured('shared/value.ts', own.sourceRoots)).toBe(true)
    expect(isMeasured('sibling/value.ts', own.sourceRoots)).toBe(false)
    expect(isMeasured('sibling/value.ts', sibling.sourceRoots)).toBe(true)
  })
})
