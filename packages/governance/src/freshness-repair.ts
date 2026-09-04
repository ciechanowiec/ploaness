// Whose repair a freshness finding is.
//
// The update report used to say the same thing on every line - `update <manifest> <name>: declared X,
// latest Y` - and left the reader to work out, line by line, whether the change was theirs to make. For
// two of the three kinds of line it is not. A coordinate in a manifest the project INHERITS belongs to
// ploaness outright. A coordinate the project declares at a version ploaness PINS is the project's line
// and not the project's number: the wiring gate holds the declaration to the pin, so taking the update
// as written produced a wiring failure on the next run. A consuming project read the flat list as a
// to-do and found that two thirds of it could not be done, which is what made the report unreadable
// rather than merely long.
//
// So a finding is sorted by the repair it names, and the report prints three groups under a heading
// that states the action once, instead of a note on every line. The sorting is a decision about what a
// project may edit, which is why it is here and not beside the registry calls that produce the lines.

import type {
  DeclaredCoordinate,
  FreshnessFinding,
  ManifestSource,
} from './dependency-freshness.js'
import { HARNESS_PACKAGE, isHarnessPackage } from './harness-package.js'
import { asRecord, asText } from './json-shapes.js'
import { isPayloadFamilyPackage } from './version-policy.js'

/**
 * Who can act on a freshness finding.
 *
 * - `project`: declared by this repository at a version it chooses. Change the declaration.
 * - `pin`: declared by this repository at a version ploaness decides. The wiring gate holds the
 *   declaration to the pin, so the repair is a ploaness release that carries the newer one.
 * - `inherited`: declared in a manifest this repository inherits from ploaness. The same repair, with
 *   no line in the project to edit at all.
 */
export type FreshnessRepair = 'project' | 'pin' | 'inherited'

/** The order the groups print in: what the reader can act on first. */
export const REPAIR_ORDER: readonly FreshnessRepair[] = ['project', 'pin', 'inherited']

/** What the report needs to know about whose version a name is. */
export interface FreshnessOwnership {
  /** Every name whose exact version ploaness pins for a project that declares it. */
  readonly pinnedByHarness: ReadonlySet<string>
  /**
   * True when the repository under judgement is ploaness itself. Its pins are a file it tracks, so a
   * pinned coordinate there is the project's to change like any other.
   */
  readonly isHarnessItself: boolean
}

/** One group of the report: the findings that share a repair, under the line that states it. */
export interface FreshnessSection {
  readonly repair: FreshnessRepair
  /** The action for every finding beneath it, stated once. */
  readonly heading: string
  readonly findings: readonly FreshnessFinding[]
}

/**
 * Whether this repository is ploaness: it tracks the manifest of the package called `ploaness`.
 *
 * Decided from what the tree contains rather than from a flag, for the reason a member's kind is
 * derived from what it declares: nothing can describe itself into a weaker reading. Read from the
 * project's own manifests only, because in a consumer the same name arrives as an INHERITED manifest,
 * and that is exactly the case this must answer `false` for.
 * @param manifests every manifest the gate read, the project's own and the inherited ones.
 * @returns true when a manifest the project tracks is ploaness's own.
 */
export const isHarnessRepository = (manifests: readonly ManifestSource[]): boolean =>
  manifests.some(
    (manifest: ManifestSource): boolean =>
      !manifest.isInherited && asText(asRecord(manifest.packageJson)['name']) === HARNESS_PACKAGE,
  )

/**
 * Whether ploaness decides the version a project declares a name at.
 *
 * Three rules, each one the wiring gate already enforces and each derived from it rather than restated:
 * a pinned name must match the pin, a `@payloadcms/*` package must match the pinned `payload`, and a
 * `@ploaness/*` package must match the declared `ploaness`. `ploaness` itself is the one exception,
 * and it proves the third rule: the release is the single version a project is entitled to choose,
 * and upgrading it is the repair every line in the two harness groups names.
 * @param name the declared name.
 * @param pinnedByHarness every name ploaness pins.
 * @returns true when the project may not change the version on its own.
 */
export const isVersionDecidedByHarness = (
  name: string,
  pinnedByHarness: ReadonlySet<string>,
): boolean =>
  name !== HARNESS_PACKAGE &&
  (pinnedByHarness.has(name) || isPayloadFamilyPackage(name) || isHarnessPackage(name))

/**
 * Whose repair one coordinate is.
 * @param coordinate the declared coordinate, with the manifest that declares it.
 * @param ownership whose version each name is.
 * @returns the group the finding belongs in.
 */
export const repairOf = (
  coordinate: DeclaredCoordinate,
  ownership: FreshnessOwnership,
): FreshnessRepair => {
  if (coordinate.isInherited) {
    return 'inherited'
  }
  return !ownership.isHarnessItself &&
    isVersionDecidedByHarness(coordinate.name, ownership.pinnedByHarness)
    ? 'pin'
    : 'project'
}

/**
 * Whether a finding is the harness release itself, in the project's own manifest.
 *
 * It is the one line in the project group whose repair is every harness line's repair, so the report
 * says so on it.
 * @param finding the finding to classify.
 * @returns true for `ploaness` declared by the project.
 */
export const isHarnessRelease = (finding: DeclaredCoordinate): boolean =>
  !finding.isInherited && finding.name === HARNESS_PACKAGE

// The two harness groups name one repair, and which one depends on whether there is a release to take.
// A heading that said "upgrade ploaness" over a project already on the latest release would send the
// reader to an upgrade that does not exist; the honest statement then is that the wait is on ploaness.
const harnessRepair = (hasNewerHarness: boolean): string =>
  hasNewerHarness
    ? `upgrading ${HARNESS_PACKAGE} is the repair`
    : `no newer ${HARNESS_PACKAGE} release is published yet, so the repair is to report a version ` +
      'that matters'

const headingOf = (repair: FreshnessRepair, hasNewerHarness: boolean): string => {
  const headings: Readonly<Record<FreshnessRepair, string>> = {
    project: 'yours to change: declared by this project at a version it chooses',
    pin:
      `pinned by ${HARNESS_PACKAGE}: declared by this project at a version ${HARNESS_PACKAGE} ` +
      `decides, and the wiring gate holds it there; ${harnessRepair(hasNewerHarness)}`,
    inherited:
      `declared by ${HARNESS_PACKAGE}: in manifests this project inherits, so there is nothing ` +
      `here to edit; ${harnessRepair(hasNewerHarness)}`,
  }
  return headings[repair]
}

/**
 * Sort the report's findings into the three repair groups, in the order they print.
 *
 * Every group is returned, empty or not, so the caller decides what an empty one prints as; the
 * order within a group is the order the findings arrived in, which is manifest order, so the same tree
 * yields the same report.
 * @param findings every finding the report will print.
 * @param ownership whose version each name is.
 * @returns the three groups, each under its heading.
 */
export const sectionFreshnessReport = (
  findings: readonly FreshnessFinding[],
  ownership: FreshnessOwnership,
): readonly FreshnessSection[] => {
  const hasNewerHarness: boolean = findings.some((finding: FreshnessFinding): boolean =>
    isHarnessRelease(finding),
  )
  return REPAIR_ORDER.map(
    (repair: FreshnessRepair): FreshnessSection => ({
      repair,
      heading: headingOf(repair, hasNewerHarness),
      findings: findings.filter(
        (finding: FreshnessFinding): boolean => repairOf(finding, ownership) === repair,
      ),
    }),
  )
}
