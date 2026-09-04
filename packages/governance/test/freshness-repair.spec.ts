import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { FreshnessFinding, ManifestSource } from '../src/dependency-freshness.js'
import {
  type FreshnessOwnership,
  type FreshnessRepair,
  type FreshnessSection,
  isHarnessRelease,
  isHarnessRepository,
  isVersionDecidedByHarness,
  REPAIR_ORDER,
  repairOf,
  sectionFreshnessReport,
} from '../src/freshness-repair.js'
import { HARNESS_PACKAGE } from '../src/harness-package.js'

const makeFinding = (
  name: string,
  isInherited = false,
  verdict: FreshnessFinding['verdict'] = 'update',
): FreshnessFinding => ({
  name,
  owner: isInherited ? `${name}/package.json` : 'package.json',
  current: '1.0.0',
  latest: '1.1.0',
  isInherited,
  verdict,
})

const PINNED: ReadonlySet<string> = new Set<string>(['next', 'typescript', '@ploaness/runtime'])

const consumer: FreshnessOwnership = { pinnedByHarness: PINNED, isHarnessItself: false }
const harnessItself: FreshnessOwnership = { pinnedByHarness: PINNED, isHarnessItself: true }

const manifest = (name: string, isInherited: boolean): ManifestSource => ({
  path: `${name}/package.json`,
  packageJson: { name },
  isInherited,
})

const namesIn = (
  sections: readonly FreshnessSection[],
  repair: FreshnessRepair,
): readonly string[] =>
  sections
    .filter((section: FreshnessSection): boolean => section.repair === repair)
    .flatMap((section: FreshnessSection): readonly string[] =>
      section.findings.map((finding: FreshnessFinding): string => finding.name),
    )

const harnessHeadings = (sections: readonly FreshnessSection[]): readonly string[] =>
  sections
    .filter((section: FreshnessSection): boolean => section.repair !== 'project')
    .map((section: FreshnessSection): string => section.heading)

describe('isVersionDecidedByHarness', () => {
  it('holds a pinned name to the harness', () => {
    expect(isVersionDecidedByHarness('next', PINNED)).toBe(true)
  })

  // Derived from the wiring rule that a `@payloadcms/*` package must carry the pinned `payload`
  // version, so a project cannot take the update the report names without failing that rule.
  it('holds a Payload family package to the harness even when it is not itself pinned', () => {
    expect(isVersionDecidedByHarness('@payloadcms/db-postgres', PINNED)).toBe(true)
  })

  it('holds a harness package to the harness', () => {
    expect(isVersionDecidedByHarness('@ploaness/runtime', new Set<string>())).toBe(true)
  })

  // The release is the one version a project chooses; every other harness line is repaired by it.
  it('leaves the harness release itself to the project', () => {
    expect(isVersionDecidedByHarness(HARNESS_PACKAGE, PINNED)).toBe(false)
  })

  it('leaves an unpinned name to the project', () => {
    expect(isVersionDecidedByHarness('zod', PINNED)).toBe(false)
  })
})

describe('repairOf', () => {
  it('sorts an inherited coordinate as inherited whatever its name', () => {
    expect(repairOf(makeFinding('zod', true), consumer)).toBe('inherited')
  })

  it('sorts a pinned coordinate the project declares as a pin', () => {
    expect(repairOf(makeFinding('next'), consumer)).toBe('pin')
  })

  it("sorts an unpinned coordinate the project declares as the project's", () => {
    expect(repairOf(makeFinding('zod'), consumer)).toBe('project')
  })

  // ploaness tracks pins.json, so a pinned coordinate in its own tree is its own to change.
  it('sorts every own coordinate as the project when the repository is the harness', () => {
    expect(repairOf(makeFinding('next'), harnessItself)).toBe('project')
  })
})

describe('isHarnessRepository', () => {
  it('recognises a tree that tracks the harness manifest', () => {
    expect(isHarnessRepository([manifest('other', false), manifest(HARNESS_PACKAGE, false)])).toBe(
      true,
    )
  })

  // A consumer reaches the same manifest by inheritance, and that is exactly the case that must be
  // read as "not ploaness".
  it('does not count the harness manifest a consumer inherits', () => {
    expect(
      isHarnessRepository([manifest('consumer', false), manifest(HARNESS_PACKAGE, true)]),
    ).toBe(false)
  })

  it('is false for a tree with no manifest at all', () => {
    expect(isHarnessRepository([])).toBe(false)
  })
})

describe('isHarnessRelease', () => {
  it('is the harness declared by the project', () => {
    expect(isHarnessRelease(makeFinding(HARNESS_PACKAGE))).toBe(true)
  })

  it('is not the harness reached through inheritance', () => {
    expect(isHarnessRelease(makeFinding(HARNESS_PACKAGE, true))).toBe(false)
  })
})

describe('sectionFreshnessReport', () => {
  const findings: readonly FreshnessFinding[] = [
    makeFinding('knip', true),
    makeFinding('next'),
    makeFinding('zod'),
    makeFinding('@payloadcms/db-postgres'),
    makeFinding('eslint', true, 'fail'),
  ]

  it('returns every group in repair order, empty or not', () => {
    const sections: readonly FreshnessSection[] = sectionFreshnessReport([], consumer)
    expect(sections.map((section: FreshnessSection): FreshnessRepair => section.repair)).toEqual(
      REPAIR_ORDER,
    )
    expect(
      sections.every((section: FreshnessSection): boolean => section.findings.length === 0),
    ).toBe(true)
  })

  it('puts each finding in the group its repair names, keeping arrival order within a group', () => {
    const sections: readonly FreshnessSection[] = sectionFreshnessReport(findings, consumer)
    expect(namesIn(sections, 'project')).toEqual(['zod'])
    expect(namesIn(sections, 'pin')).toEqual(['next', '@payloadcms/db-postgres'])
    expect(namesIn(sections, 'inherited')).toEqual(['knip', 'eslint'])
  })

  // A heading over the harness groups names an upgrade only when one exists. Sending a reader on the
  // latest release to "upgrade ploaness" would be an instruction with nothing to act on.
  it('names the harness upgrade as the repair when a newer release is among the findings', () => {
    const sections: readonly FreshnessSection[] = sectionFreshnessReport(
      [...findings, makeFinding(HARNESS_PACKAGE)],
      consumer,
    )
    for (const heading of harnessHeadings(sections)) {
      expect(heading).toContain(`upgrading ${HARNESS_PACKAGE} is the repair`)
    }
  })

  it('says the wait is on a harness release when no newer one is among the findings', () => {
    const sections: readonly FreshnessSection[] = sectionFreshnessReport(findings, consumer)
    for (const heading of harnessHeadings(sections)) {
      expect(heading).toContain(`no newer ${HARNESS_PACKAGE} release is published yet`)
    }
  })

  it("says the project's own group is the project's to change", () => {
    const [project]: readonly FreshnessSection[] = sectionFreshnessReport(findings, consumer)
    expect(project?.heading).toMatch(/^yours to change/u)
  })

  it('places the harness release itself in the project group', () => {
    const [project]: readonly FreshnessSection[] = sectionFreshnessReport(
      [makeFinding(HARNESS_PACKAGE)],
      consumer,
    )
    expect(project?.findings.map((finding: FreshnessFinding): string => finding.name)).toEqual([
      HARNESS_PACKAGE,
    ])
  })
})

describe('freshness-repair properties (fast-check)', () => {
  const findingArbitrary: fc.Arbitrary<FreshnessFinding> = fc
    .record({
      name: fc.oneof(
        fc.constant('next'),
        fc.constant('zod'),
        fc.constant(HARNESS_PACKAGE),
        fc.constant('@payloadcms/ui'),
        fc.constant('@ploaness/runtime'),
      ),
      isInherited: fc.boolean(),
      verdict: fc.constantFrom<FreshnessFinding['verdict']>('update', 'fail'),
    })
    .map(
      ({ name, isInherited, verdict }): FreshnessFinding => ({
        ...makeFinding(name, isInherited, verdict),
      }),
    )

  // Sorting must neither lose nor duplicate a finding: the report is the whole of what was measured.
  it('partitions the findings exactly once across the groups', () => {
    fc.assert(
      fc.property(
        fc.array(findingArbitrary),
        fc.boolean(),
        (findings: readonly FreshnessFinding[], isHarnessItself: boolean): void => {
          const sections: readonly FreshnessSection[] = sectionFreshnessReport(findings, {
            pinnedByHarness: PINNED,
            isHarnessItself,
          })
          const placed: readonly FreshnessFinding[] = sections.flatMap(
            (section: FreshnessSection): readonly FreshnessFinding[] => section.findings,
          )
          expect(placed).toHaveLength(findings.length)
          expect(new Set<FreshnessFinding>(placed)).toEqual(new Set<FreshnessFinding>(findings))
        },
      ),
    )
  })

  it('never sorts an own coordinate as a pin when the repository is the harness', () => {
    fc.assert(
      fc.property(findingArbitrary, (finding: FreshnessFinding): void => {
        expect(repairOf(finding, harnessItself)).not.toBe('pin')
      }),
    )
  })
})
