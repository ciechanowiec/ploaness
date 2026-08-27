// Which paths an exclusion has to reach is decided by the setting it came from. Getting that wrong is
// not a cosmetic misreport: `pureLogicRoots` names DIRECTORIES, and judged against tracked file paths it
// could never reach anything, so a project declaring a floor that exists was told its declaration
// excluded nothing - while the only pattern that satisfied the check, `src/config/**`, renders through
// `pureLogicRule` as `^(src/config/**\/)`, which is not a valid regular expression. The setting had no
// legal value at all. These specs pin each half of that so neither can come back alone.
import { describe, expect, it } from 'vitest'
import type { DeclaredExclusion } from '../src/settings.js'
import { findUnreachedExclusionsBySetting, trackedDirectories } from '../src/settings.js'

const TRACKED: readonly string[] = [
  'src/config/featureKeys.ts',
  'src/config/fonts.ts',
  'src/lib/features.ts',
  'src/payload-types.ts',
  'scripts/seed.ts',
  'README.md',
]

const entry = (setting: string, pattern: string): DeclaredExclusion => ({
  setting,
  pattern,
  reason: 'a stated role',
  kind: 'glob',
})

describe('trackedDirectories', () => {
  it('yields every containing directory at every depth, once', () => {
    expect(
      [...trackedDirectories(TRACKED)].sort((left: string, right: string): number =>
        left.localeCompare(right),
      ),
    ).toEqual(['scripts', 'src', 'src/config', 'src/lib'])
  })

  it('yields nothing for a file at the repository root', () => {
    expect(trackedDirectories(['README.md'])).toEqual([])
  })
})

describe('findUnreachedExclusionsBySetting', () => {
  it('accepts a pureLogicRoots entry naming a directory that holds a tracked file', () => {
    expect(
      findUnreachedExclusionsBySetting([entry('pureLogicRoots', 'src/config')], TRACKED),
    ).toEqual([])
  })

  it('reports a pureLogicRoots entry naming a directory no tracked file lives under', () => {
    const found: readonly string[] = findUnreachedExclusionsBySetting(
      [entry('pureLogicRoots', 'src/domain')],
      TRACKED,
    )
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('src/domain')
  })

  it('gives each setting its own candidate set within a single call', () => {
    // The joint the composition exists for: one directory entry and one file entry, both legal, both
    // judged correctly only because they were partitioned before matching.
    expect(
      findUnreachedExclusionsBySetting(
        [
          entry('pureLogicRoots', 'src/config'),
          entry('generatedArtefacts', 'src/payload-types.ts'),
        ],
        TRACKED,
      ),
    ).toEqual([])
  })
})

describe('findUnreachedExclusionsBySetting, per setting', () => {
  it('still judges a file-shaped setting against the tracked files', () => {
    expect(
      findUnreachedExclusionsBySetting(
        [entry('generatedArtefacts', 'src/payload-types.ts')],
        TRACKED,
      ),
    ).toEqual([])
    expect(
      findUnreachedExclusionsBySetting([entry('generatedArtefacts', 'src/gone.ts')], TRACKED),
    ).toHaveLength(1)
  })

  it('judges coverageExclude against the measured files rather than every tracked file', () => {
    // README.md is tracked but outside COVERAGE_INCLUDE, so excluding it from the coverage report
    // records a decision with no effect - which every other setting would have called reachable.
    expect(
      findUnreachedExclusionsBySetting([entry('coverageExclude', 'README.md')], TRACKED),
    ).toHaveLength(1)
    expect(
      findUnreachedExclusionsBySetting([entry('coverageExclude', 'src/config/fonts.ts')], TRACKED),
    ).toEqual([])
  })

  it('tolerates a trailing slash on a directory setting, as the renderer does', () => {
    // pureLogicRule already accepted `src/config/` and this rule already reported it. Normalising in
    // one place is what stops the two disagreeing.
    expect(
      findUnreachedExclusionsBySetting([entry('pureLogicRoots', 'src/config/')], TRACKED),
    ).toEqual([])
  })

  it('reports a glob-shaped pureLogicRoots entry, which renders to a floor matching nothing', () => {
    // The value that used to be the only one satisfying this rule. It is spliced into a regular
    // expression by pureLogicRule, so it can never name a floor - and now it is said so rather than
    // silently honoured.
    expect(
      findUnreachedExclusionsBySetting([entry('pureLogicRoots', 'src/config/**')], TRACKED),
    ).toHaveLength(1)
  })
})
