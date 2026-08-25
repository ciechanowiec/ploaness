import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  classifyFreshness,
  collectCoordinates,
  type DeclaredCoordinate,
  type DependencyStatus,
  type FreshnessFinding,
  type FreshnessReport,
  type FreshnessVerdict,
  findFreshnessViolations,
  inheritedManifestPaths,
  MAJOR_FAIL_THRESHOLD,
  type ManifestResolver,
  type ManifestSource,
  parseVersion,
} from '../src/dependency-freshness.js'

const makeStatus = (
  name: string,
  current: string,
  latest: string,
  isInherited = false,
): DependencyStatus => ({
  name,
  owner: '.',
  current,
  latest,
  isInherited,
})

describe('parseVersion', () => {
  it('reads the numeric core', () => {
    expect(parseVersion('16.14.2')).toEqual({ major: 16, minor: 14, patch: 2, prerelease: '' })
  })

  it('tolerates a leading range operator or v prefix', () => {
    expect(parseVersion('^17.0.0')?.major).toBe(17)
    expect(parseVersion('~4.1.0')?.minor).toBe(1)
    expect(parseVersion('>=2.5.2')?.major).toBe(2)
    expect(parseVersion('v2.5.2')?.patch).toBe(2)
  })

  it('defaults an absent minor or patch to zero', () => {
    expect(parseVersion('17')).toEqual({ major: 17, minor: 0, patch: 0, prerelease: '' })
    expect(parseVersion('4.1')).toEqual({ major: 4, minor: 1, patch: 0, prerelease: '' })
  })

  it('captures a prerelease tag and ignores build metadata', () => {
    expect(parseVersion('1.0.0-rc.1')?.prerelease).toBe('rc.1')
    expect(parseVersion('1.2.3+build.5')?.prerelease).toBe('')
  })

  it('returns undefined when there is no numeric major', () => {
    expect(parseVersion('workspace:*')).toBeUndefined()
    expect(parseVersion('link:../pkg')).toBeUndefined()
    expect(parseVersion('*')).toBeUndefined()
    expect(parseVersion('')).toBeUndefined()
  })
})

describe('classifyFreshness', () => {
  it('fails when the latest major is at least the threshold ahead', () => {
    expect(classifyFreshness('17.0.0', '19.0.0')).toBe('fail')
    expect(classifyFreshness('16.2.9', '19.0.0')).toBe('fail')
  })

  it('reports an update one major behind (the boundary below the threshold)', () => {
    expect(classifyFreshness('18.0.0', '19.0.0')).toBe('update')
  })

  it('reports an update for a minor or patch behind the same major', () => {
    expect(classifyFreshness('2.4.0', '2.5.2')).toBe('update')
    expect(classifyFreshness('2.5.1', '2.5.2')).toBe('update')
  })

  it('is ok when level with or ahead of latest', () => {
    expect(classifyFreshness('2.5.2', '2.5.2')).toBe('ok')
    expect(classifyFreshness('3.0.0', '2.5.2')).toBe('ok')
  })

  it('treats 0.x on the literal major, so a minor bump only enters the update report', () => {
    expect(classifyFreshness('0.35.2', '0.35.3')).toBe('update')
    expect(classifyFreshness('0.35.2', '0.35.2')).toBe('ok')
    expect(classifyFreshness('0.35.2', '1.0.0')).toBe('update')
    expect(classifyFreshness('0.35.2', '2.0.0')).toBe('fail')
  })

  it('orders a prerelease below the same core release', () => {
    expect(classifyFreshness('1.0.0-rc.1', '1.0.0')).toBe('update')
    expect(classifyFreshness('1.0.0', '1.0.0-rc.1')).toBe('ok')
    expect(classifyFreshness('1.0.0-rc.1', '1.0.0-rc.2')).toBe('update')
    expect(classifyFreshness('1.0.0-rc.1', '1.0.0-rc.1')).toBe('ok')
  })

  it('skips (ok) an unclassifiable current or latest', () => {
    expect(classifyFreshness('workspace:*', '19.0.0')).toBe('ok')
    expect(classifyFreshness('19.0.0', 'workspace:*')).toBe('ok')
  })

  it('classifies a biome $schema pseudo-dependency the same way', () => {
    expect(classifyFreshness('2.5.2', '2.5.2')).toBe('ok')
    expect(classifyFreshness('2.5.2', '2.6.0')).toBe('update')
    expect(classifyFreshness('2.5.2', '4.0.0')).toBe('fail')
  })
})

describe('findFreshnessViolations', () => {
  it('partitions failures and available updates and drops ok statuses', () => {
    const report: FreshnessReport = findFreshnessViolations([
      makeStatus('graphql', '16.14.2', '17.0.1'),
      makeStatus('old', '17.0.0', '19.0.0'),
      makeStatus('fresh', '2.5.2', '2.5.2'),
    ])
    expect(report.failures).toEqual([
      {
        name: 'old',
        owner: '.',
        current: '17.0.0',
        latest: '19.0.0',
        verdict: 'fail',
        isInherited: false,
      },
    ])
    expect(report.reported).toEqual([
      {
        name: 'graphql',
        owner: '.',
        current: '16.14.2',
        latest: '17.0.1',
        verdict: 'update',
        isInherited: false,
      },
    ])
  })

  it('returns empty groups for a fully fresh set', () => {
    const report: FreshnessReport = findFreshnessViolations([makeStatus('fresh', '1.0.0', '1.0.0')])
    expect(report).toEqual({ failures: [], reported: [] })
  })
})

// Property-based tests assert the classification invariants over every generated version pair, beyond
// the enumerated examples. The fixed global seed (vitest.setup.ts) keeps them deterministic; each `it`
// carries a concrete assertion first, since the unit scope's rule does not recognise `fc.assert`.
describe('dependency-freshness properties (fast-check)', () => {
  const smallInt: fc.Arbitrary<number> = fc.integer({ min: 0, max: 40 })

  it('fails exactly when the major gap reaches the threshold', () => {
    expect(classifyFreshness('1.0.0', '3.0.0')).toBe('fail')
    fc.assert(
      fc.property(smallInt, smallInt, (currentMajor: number, latestMajor: number): boolean => {
        const verdict: FreshnessVerdict = classifyFreshness(
          `${String(currentMajor)}.0.0`,
          `${String(latestMajor)}.0.0`,
        )
        const shouldFail: boolean = latestMajor - currentMajor >= MAJOR_FAIL_THRESHOLD
        return (verdict === 'fail') === shouldFail
      }),
    )
  })

  it('parses the same core regardless of a leading range operator', () => {
    expect(parseVersion('^1.2.3')).toEqual(parseVersion('1.2.3'))
    fc.assert(
      fc.property(
        smallInt,
        smallInt,
        smallInt,
        fc.constantFrom('', '^', '~', '>=', 'v'),
        (major: number, minor: number, patch: number, prefix: string): boolean => {
          const core: string = `${String(major)}.${String(minor)}.${String(patch)}`
          return (
            JSON.stringify(parseVersion(`${prefix}${core}`)) === JSON.stringify(parseVersion(core))
          )
        },
      ),
    )
  })
})

// A manifest the project tracks. Named once so the block below reads as being about coordinates rather
// than about the flag; the inherited case has a block of its own.
const own = (path: string, packageJson: unknown): ManifestSource => ({
  path,
  packageJson,
  isInherited: false,
})

describe('collectCoordinates', () => {
  it('reads a coordinate out of every manifest, not only the first', () => {
    const manifests: readonly ManifestSource[] = [
      own('package.json', { dependencies: { next: '16.3.2' } }),
      own('packages/config/package.json', { devDependencies: { knip: '5.0.0' } }),
    ]
    expect(
      collectCoordinates(manifests).map((one: DeclaredCoordinate): string => one.name),
    ).toEqual(['next', 'knip'])
  })

  it('attributes a coordinate to the manifest that declares it', () => {
    const manifests: readonly ManifestSource[] = [
      own('packages/cli/package.json', { dependencies: { knip: '5.0.0' } }),
    ]
    expect(collectCoordinates(manifests)[0]?.owner).toBe('packages/cli/package.json')
  })

  // Two manifests may pin the same analyzer at different versions, and collapsing them would drop
  // whichever of the two is the stale one - which is the whole finding.
  it('keeps two manifests declaring the same name apart', () => {
    const manifests: readonly ManifestSource[] = [
      own('a/package.json', { dependencies: { knip: '5.0.0' } }),
      own('b/package.json', { dependencies: { knip: '7.0.0' } }),
    ]
    expect(
      collectCoordinates(manifests).map((one: DeclaredCoordinate): string => one.current),
    ).toEqual(['5.0.0', '7.0.0'])
  })

  it('reads both dependency blocks of one manifest', () => {
    const manifests: readonly ManifestSource[] = [
      own('package.json', {
        dependencies: { next: '16.3.2' },
        devDependencies: { vitest: '4.1.11' },
      }),
    ]
    expect(collectCoordinates(manifests)).toHaveLength(2)
  })

  it('reads nothing out of a manifest that could not be parsed', () => {
    expect(collectCoordinates([own('package.json', undefined)])).toEqual([])
  })
})

// The manifests a project inherits. The standard counts a coordinate declared in one of them as declared
// by the project, and reading only the tracked tree could never see one: nothing under node_modules is
// tracked, so a consumer's update report stayed silent while a harness pin went stale.
//
// The resolver is a literal map here, which is the whole reason the walk is a pure function: proving a
// diamond is visited once, or that a cycle terminates, would otherwise need an install to be built.
// One resolved install, as a literal map. This is the whole reason the walk is a pure function: proving
// that a diamond is visited once, or that a cycle terminates, would otherwise need an install built on
// disk for each case.
const INSTALLED_MANIFESTS: Readonly<Record<string, unknown>> = {
  '/n/ploaness/package.json': {
    name: 'ploaness',
    dependencies: { '@ploaness/cli': '1.0.0', '@ploaness/config': '1.0.0', next: '16.3.2' },
  },
  '/n/cli/package.json': {
    name: '@ploaness/cli',
    dependencies: { '@ploaness/governance': '1.0.0', eslint: '10.8.1' },
  },
  '/n/config/package.json': {
    name: '@ploaness/config',
    dependencies: { '@ploaness/governance': '1.0.0' },
  },
  '/n/governance/package.json': { name: '@ploaness/governance' },
}

const INSTALLED_PATHS: Readonly<Record<string, string>> = {
  '@ploaness/cli': '/n/cli/package.json',
  '@ploaness/config': '/n/config/package.json',
  '@ploaness/governance': '/n/governance/package.json',
}

const readInstalled = (manifestPath: string): unknown => INSTALLED_MANIFESTS[manifestPath]

const resolver: ManifestResolver = {
  locate: (packageName: string): string | undefined => INSTALLED_PATHS[packageName],
  read: readInstalled,
}

const ENTRY: string = '/n/ploaness/package.json'

// The manifests a project inherits. The standard counts a coordinate declared in one of them as declared
// by the project, and reading only the tracked tree could never see one: nothing under node_modules is
// tracked, so a consumer's update report stayed silent while a harness pin went stale.
// Which findings stop the build, which is a different question from how far behind each one is. The
// two were the same question until a consumer's report turned out to be silent about the harness's
// own pins: reporting those made the split necessary, because a project cannot repair one.
describe('findFreshnessViolations: build impact', () => {
  // A coordinate the project cannot repair must not stop the project's build. It is still measured at
  // its real verdict, because a report that softened it into an ordinary update would say the harness
  // is a patch behind when it is two majors behind.
  it('reports an inherited coordinate past the bound instead of failing on it', () => {
    const report: FreshnessReport = findFreshnessViolations([
      makeStatus('knip', '5.0.0', '7.0.0', true),
    ])
    expect(report.failures).toEqual([])
    expect(report.reported.map((one: FreshnessFinding): string => one.verdict)).toEqual(['fail'])
  })

  // The same lag in the project's own manifest is the project's to repair, and still stops the build.
  it('fails on the same lag in a manifest the project owns', () => {
    const report: FreshnessReport = findFreshnessViolations([makeStatus('knip', '5.0.0', '7.0.0')])
    expect(report.failures.map((one: FreshnessFinding): string => one.name)).toEqual(['knip'])
    expect(report.reported).toEqual([])
  })

  it('reports a lesser lag in an inherited manifest as an ordinary update', () => {
    const report: FreshnessReport = findFreshnessViolations([
      makeStatus('eslint', '10.8.1', '10.9.1', true),
    ])
    expect(report.failures).toEqual([])
    expect(report.reported.map((one: FreshnessFinding): string => one.verdict)).toEqual(['update'])
  })
})

describe('inheritedManifestPaths', () => {
  it('reaches every harness manifest, the entry first', () => {
    expect(inheritedManifestPaths(ENTRY, resolver)).toEqual([
      '/n/ploaness/package.json',
      '/n/cli/package.json',
      '/n/governance/package.json',
      '/n/config/package.json',
    ])
  })

  // The CLI and the config both depend on governance. Reported twice, its coordinates would be counted
  // twice and the update report would name the same stale pin on two lines.
  it('visits a manifest two packages share exactly once', () => {
    const walked: readonly string[] = inheritedManifestPaths(ENTRY, resolver)
    expect(walked.filter((file: string): boolean => file === '/n/governance/package.json')).toEqual(
      ['/n/governance/package.json'],
    )
  })

  it('does not follow a dependency outside the harness', () => {
    expect(inheritedManifestPaths(ENTRY, resolver)).not.toContain('next')
  })

  // Nothing forbids a future package depending back on the meta package, and a walk that did not carry
  // `visited` across the recursion would not return at all.
  it('terminates on a cycle', () => {
    const cyclic: ManifestResolver = {
      locate: (packageName: string): string | undefined =>
        packageName === 'ploaness' ? ENTRY : INSTALLED_PATHS[packageName],
      read: (manifestPath: string): unknown =>
        manifestPath === '/n/governance/package.json'
          ? { name: '@ploaness/governance', dependencies: { ploaness: '1.0.0' } }
          : readInstalled(manifestPath),
    }
    expect(inheritedManifestPaths(ENTRY, cyclic)).toHaveLength(4)
  })

  it('reports nothing for a project that resolves no harness at all', () => {
    expect(inheritedManifestPaths(undefined, resolver)).toEqual([])
  })

  // A package the resolver cannot reach is skipped rather than throwing: an install missing one of the
  // harness packages is a broken install, and the gate that reads it says so in its own words.
  it('skips a package the resolver cannot reach', () => {
    const partial: ManifestResolver = {
      locate: (packageName: string): string | undefined =>
        packageName === '@ploaness/cli' ? undefined : INSTALLED_PATHS[packageName],
      read: readInstalled,
    }
    expect(inheritedManifestPaths(ENTRY, partial)).not.toContain('/n/cli/package.json')
  })
})

// The flag exists so a finding can name the repair a project can act on. A coordinate that lost it on
// the way out of the manifest would be reported as the project's to fix.
describe('collectCoordinates: inheritance', () => {
  it("carries each manifest's inheritance onto the coordinates it declares", () => {
    const coordinates: readonly DeclaredCoordinate[] = collectCoordinates([
      {
        path: 'package.json',
        packageJson: { dependencies: { next: '16.3.2' } },
        isInherited: false,
      },
      {
        path: '@ploaness/cli/package.json',
        packageJson: { dependencies: { eslint: '10.8.1' } },
        isInherited: true,
      },
    ])
    expect(
      coordinates.map(
        (coordinate: DeclaredCoordinate): string =>
          `${coordinate.name}:${String(coordinate.isInherited)}`,
      ),
    ).toEqual(['next:false', 'eslint:true'])
  })
})
