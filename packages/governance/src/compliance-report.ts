// The open source software report on dependencies: the evidence behind the licence and vulnerability
// gates, assembled into one model a reviewer outside the project can read. Everything here is derived from
// values already read.
import { asRecord, readKey } from './json-shapes.js'
import { LICENSE_POLICY, type LicenseClass, licenseClassOf } from './license-allowlist.js'
import { coordinateOf, type InventoryPackage } from './license-inventory.js'
import {
  type Advisory,
  type MitigatedAdvisory,
  severityRank,
  type VulnerabilityClassification,
  type VulnerabilityException,
} from './vulnerability-policy.js'

/** One licence file a package ships, as read from its installed directory. */
export interface NoticeFile {
  readonly name: string
  readonly text: string
}

/** The licence files one installed package version ships. */
export interface PackageNotices {
  readonly coordinate: string
  readonly files: readonly NoticeFile[]
}

/** Where the report's source stands. */
export interface ReportSource {
  readonly commit: string
  readonly isDirty: boolean
  readonly fingerprint: string
  readonly lockfileSha256: string
}

/** The SBOM the report embeds. */
export interface ReportSbom {
  readonly sha256: string
  readonly components: number
  readonly generator: string
}

/** Everything the report is built from. */
export interface ComplianceReportInput {
  readonly projectName: string
  readonly projectDescription: string | undefined
  readonly source: ReportSource
  readonly generatedAt: string
  readonly harnessVersion: string
  readonly packages: readonly InventoryPackage[]
  readonly production: readonly InventoryPackage[]
  readonly directNames: readonly string[]
  readonly vulnerabilities: VulnerabilityClassification
  readonly advisoryRecords: number
  readonly auditedAt: string
  readonly sbom: ReportSbom
  readonly notices: readonly PackageNotices[]
}

/** One installed package version as the report lists it. */
export interface ReportPackage {
  readonly name: string
  /** Empty for a directory dependency, which pnpm reports without a version. */
  readonly version: string
  readonly license: string
  readonly licenseClass: LicenseClass
  readonly isProduction: boolean
  readonly isDirect: boolean
  readonly homepage: string | undefined
}

/** How many package versions declare one licence. */
export interface LicenseCount {
  readonly license: string
  readonly licenseClass: LicenseClass
  readonly count: number
}

/** One licence text and every distributed package version that ships it. */
export interface NoticeGroup {
  readonly text: string
  readonly fileNames: readonly string[]
  readonly coordinates: readonly string[]
}

/** One reported advisory as the report lists it, with the mitigation that covers it, if any. */
export interface ReportAdvisory {
  readonly advisory: Advisory
  /** Whether any installed version of the package is in the production graph. */
  readonly isProduction: boolean
  /** Undefined while the advisory is open. */
  readonly mitigation: VulnerabilityException | undefined
  readonly isHarnessMitigation: boolean
}

/** The assembled report. */
export interface ComplianceReport {
  readonly projectName: string
  readonly projectDescription: string | undefined
  readonly source: ReportSource
  readonly generatedAt: string
  readonly harnessVersion: string
  /** Whether every license is within the policy and no advisory is open or recorded without a match. */
  readonly isWithinPolicy: boolean
  /** Why the report is not release evidence; empty when it is. */
  readonly draftReasons: readonly string[]
  readonly packages: readonly ReportPackage[]
  readonly productionCount: number
  readonly directCount: number
  readonly licenseCounts: readonly LicenseCount[]
  readonly classCounts: Readonly<Record<LicenseClass, number>>
  readonly copyleft: readonly ReportPackage[]
  readonly refused: readonly ReportPackage[]
  readonly policy: typeof LICENSE_POLICY
  readonly vulnerabilities: VulnerabilityClassification
  /** Every advisory, most severe first. */
  readonly advisories: readonly ReportAdvisory[]
  readonly advisoryRecords: number
  readonly auditedAt: string
  readonly sbom: ReportSbom
  readonly notices: readonly NoticeGroup[]
  /** Distributed package versions whose installed directory carries no licence file. */
  readonly withoutNotice: readonly string[]
}

const byText = (left: string, right: string): number => left.localeCompare(right)

const byName = (left: ReportPackage, right: ReportPackage): number =>
  left.name.localeCompare(right.name) || left.version.localeCompare(right.version)

// A directory dependency has no version, so it is identified by its name alone.
const coordinatesOf = (entry: InventoryPackage): readonly string[] =>
  entry.versions.length === 0
    ? [entry.name]
    : entry.versions.map((version: string): string => coordinateOf(entry.name, version))

const rowsOf = (entry: InventoryPackage): readonly { readonly version: string; readonly entry: InventoryPackage }[] =>
  (entry.versions.length === 0 ? [''] : entry.versions).map((version: string) => ({ version, entry }))

const reportPackages = (input: ComplianceReportInput): readonly ReportPackage[] => {
  const production: ReadonlySet<string> = new Set(
    input.production.flatMap((entry: InventoryPackage): readonly string[] => coordinatesOf(entry)),
  )
  const direct: ReadonlySet<string> = new Set(input.directNames)
  return input.packages
    .flatMap((entry: InventoryPackage) => rowsOf(entry))
    .map(
      ({ version, entry }): ReportPackage => ({
        name: entry.name,
        version,
        license: entry.license,
        licenseClass: licenseClassOf(entry.license),
        isProduction: production.has(version.length > 0 ? coordinateOf(entry.name, version) : entry.name),
        isDirect: direct.has(entry.name),
        homepage: entry.homepage,
      }),
    )
    .toSorted(byName)
}

const countLicenses = (packages: readonly ReportPackage[]): readonly LicenseCount[] =>
  [...new Set(packages.map((row: ReportPackage): string => row.license))]
    .map(
      (license: string): LicenseCount => ({
        license,
        licenseClass: licenseClassOf(license),
        count: packages.filter((row: ReportPackage): boolean => row.license === license).length,
      }),
    )
    .toSorted(
      (left: LicenseCount, right: LicenseCount): number =>
        right.count - left.count || left.license.localeCompare(right.license),
    )

const countClasses = (packages: readonly ReportPackage[]): Readonly<Record<LicenseClass, number>> => ({
  permissive: packages.filter((row: ReportPackage): boolean => row.licenseClass === 'permissive').length,
  'weak-copyleft': packages.filter((row: ReportPackage): boolean => row.licenseClass === 'weak-copyleft').length,
  refused: packages.filter((row: ReportPackage): boolean => row.licenseClass === 'refused').length,
})

// Every advisory once, most severe first, so the list reads the way a reviewer triages.
const reportAdvisories = (
  classification: VulnerabilityClassification,
  packages: readonly ReportPackage[],
): readonly ReportAdvisory[] => {
  const production: ReadonlySet<string> = new Set(
    packages.filter((row: ReportPackage): boolean => row.isProduction).map((row: ReportPackage): string => row.name),
  )
  return [
    ...classification.open.map(
      (advisory: Advisory): ReportAdvisory => ({
        advisory,
        isProduction: production.has(advisory.packageName),
        mitigation: undefined,
        isHarnessMitigation: false,
      }),
    ),
    ...classification.mitigated.map(
      (entry: MitigatedAdvisory): ReportAdvisory => ({
        advisory: entry.advisory,
        isProduction: production.has(entry.advisory.packageName),
        mitigation: entry.exception,
        isHarnessMitigation: entry.isHarnessException,
      }),
    ),
  ].toSorted(
    (left: ReportAdvisory, right: ReportAdvisory): number =>
      severityRank(right.advisory.severity) - severityRank(left.advisory.severity) ||
      left.advisory.packageName.localeCompare(right.advisory.packageName) ||
      left.advisory.id.localeCompare(right.advisory.id),
  )
}

// A line that opens a list item or a copyright statement starts a new line of its own, and so does the line
// after a heading or a ruled separator. Every other line of a paragraph continues the one before it:
// licence files are wrapped at a fixed width for a terminal, and keeping those breaks in a proportional
// column leaves every line ragged. A copyright statement names a year, (c) or the sign, so a sentence that
// merely wraps before "Copyright Holder" continues.
const LIST_ITEM: RegExp = /^(?:[-*+\u{2022}]\s|\(?(?:\d{1,3}|[a-z]|[ivx]{2,4})[.)]\s)/iu
const COPYRIGHT_LINE: RegExp = /^(?:copyright\s+(?:\(c\)|\u{A9}|\d{4})|\u{A9})/iu
const PARAGRAPH_BREAK: RegExp = /\n[ \t]*\n/u
// Licence files bundled into a Markdown document quote each licence (`> `) and title it with a heading
// (`## name`), and list the package's facts as `License: MIT` lines. The markers are markup, not words.
const QUOTE_MARKERS: RegExp = /^[ \t]*(?:>[ \t]?)+/u
const MARKDOWN_HEADING: RegExp = /^#{1,6}[ \t]+/u
const FIELD_LINE: RegExp = /^[A-Z][A-Za-z]{1,20}(?: [A-Za-z]{1,20})?:[ \t]/u
const SEPARATOR: RegExp = /^[-=_*~]{3,}$/u
const HEADING_LENGTH: number = 40
const LOWERCASE: RegExp = /\p{Ll}/u
const LETTER: RegExp = /\p{L}/u
const HYPHENATED_END: RegExp = /\p{L}-$/u
const LOWERCASE_START: RegExp = /^\p{Ll}/u

// A short line with letters and no lowercase one is a heading such as PREAMBLE, not the start of a sentence.
const isHeading = (line: string): boolean => line.length < HEADING_LENGTH && LETTER.test(line) && !LOWERCASE.test(line)

// The line itself announces something new: a list item, a copyright statement, a field, a heading, a rule.
const opensLine = (line: string): boolean =>
  LIST_ITEM.test(line) ||
  COPYRIGHT_LINE.test(line) ||
  FIELD_LINE.test(line) ||
  MARKDOWN_HEADING.test(line) ||
  SEPARATOR.test(line)

// The line before it stands alone, so nothing continues it: a field, a rule, a heading.
const endsLine = (previous: string): boolean =>
  FIELD_LINE.test(previous) || SEPARATOR.test(previous) || MARKDOWN_HEADING.test(previous) || isHeading(previous)

const startsLine = (previous: string, line: string): boolean => opensLine(line) || endsLine(previous)

const joinLines = (lines: readonly string[], line: string): readonly string[] => {
  const previous: string | undefined = lines.at(-1)
  if (previous === undefined || startsLine(previous, line)) {
    return [...lines, line]
  }
  // A word broken at a hyphen is rejoined without a space, so `non-` and `exclusive` read `non-exclusive`.
  const separator: string = HYPHENATED_END.test(previous) && LOWERCASE_START.test(line) ? '' : ' '
  return [...lines.slice(0, -1), `${previous}${separator}${line}`]
}

/**
 * Reflow a licence file for a proportional column. Words and their order are unchanged; only the
 * fixed-width line breaks inside a paragraph are removed, and runs of spaces collapse to one.
 * @param text the licence file as shipped.
 * @returns the text with paragraphs separated by a blank line and kept line breaks by a newline.
 */
export const reflowLicenseText = (text: string): string =>
  text
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line: string): string => line.replace(QUOTE_MARKERS, ''))
    .join('\n')
    .trim()
    .split(PARAGRAPH_BREAK)
    .map((block: string): string =>
      block
        .split('\n')
        .map((line: string): string => line.trim().replaceAll(/[ \t]+/gu, ' '))
        .filter((line: string): boolean => line.length > 0)
        .reduce((lines: readonly string[], line: string): readonly string[] => joinLines(lines, line), [])
        .join('\n'),
    )
    .filter((block: string): boolean => block.length > 0)
    .join('\n\n')

interface NoticeEntry {
  readonly text: string
  readonly fileName: string
  readonly coordinate: string
}

// Attribution obligations attach to what is distributed, so the notices cover the production graph.
// Identical texts are printed once; most permissive licences differ only in their copyright line, so
// the grouping is by the reflowed text rather than by the licence name.
const groupNotices = (notices: readonly PackageNotices[], distributed: ReadonlySet<string>): readonly NoticeGroup[] => {
  const entries: readonly NoticeEntry[] = notices
    .filter((notice: PackageNotices): boolean => distributed.has(notice.coordinate))
    .flatMap((notice: PackageNotices): readonly NoticeEntry[] =>
      notice.files.map(
        (file: NoticeFile): NoticeEntry => ({
          text: reflowLicenseText(file.text),
          fileName: file.name,
          coordinate: notice.coordinate,
        }),
      ),
    )
  return [...new Set(entries.map((entry: NoticeEntry): string => entry.text))]
    .map((text: string): NoticeGroup => {
      const sharing: readonly NoticeEntry[] = entries.filter((entry: NoticeEntry): boolean => entry.text === text)
      return {
        text,
        fileNames: [...new Set(sharing.map((entry: NoticeEntry): string => entry.fileName))].toSorted(byText),
        coordinates: [...new Set(sharing.map((entry: NoticeEntry): string => entry.coordinate))].toSorted(byText),
      }
    })
    .toSorted((left: NoticeGroup, right: NoticeGroup): number =>
      (left.coordinates[0] ?? '').localeCompare(right.coordinates[0] ?? ''),
    )
}

const coordinateOfRow = (row: ReportPackage): string =>
  row.version.length > 0 ? coordinateOf(row.name, row.version) : row.name

const draftReasonsOf = (input: ComplianceReportInput, isWithinPolicy: boolean): readonly string[] => [
  ...(input.source.isDirty ? ['The working tree has uncommitted changes, so no commit describes this source.'] : []),
  ...(isWithinPolicy ? [] : ["The dependencies don't satisfy the policy this report states."]),
]

/**
 * Assemble the compliance report.
 * @param input the inventory, the vulnerability classification and the provenance already read.
 * @returns the report model the renderer prints.
 */
export const buildComplianceReport = (input: ComplianceReportInput): ComplianceReport => {
  const packages: readonly ReportPackage[] = reportPackages(input)
  const refused: readonly ReportPackage[] = packages.filter(
    (row: ReportPackage): boolean => row.licenseClass === 'refused',
  )
  const isMeetsPolicy: boolean =
    refused.length === 0 && input.vulnerabilities.open.length === 0 && input.vulnerabilities.deadEntries.length === 0
  const distributed: ReadonlySet<string> = new Set(
    packages
      .filter((row: ReportPackage): boolean => row.isProduction)
      .map((row: ReportPackage): string => coordinateOfRow(row)),
  )
  const shipped: ReadonlySet<string> = new Set(
    input.notices
      .filter((notice: PackageNotices): boolean => notice.files.length > 0)
      .map((notice: PackageNotices): string => notice.coordinate),
  )
  return {
    projectName: input.projectName,
    projectDescription: input.projectDescription,
    source: input.source,
    generatedAt: input.generatedAt,
    harnessVersion: input.harnessVersion,
    isWithinPolicy: isMeetsPolicy,
    draftReasons: draftReasonsOf(input, isMeetsPolicy),
    packages,
    productionCount: packages.filter((row: ReportPackage): boolean => row.isProduction).length,
    directCount: packages.filter((row: ReportPackage): boolean => row.isDirect).length,
    licenseCounts: countLicenses(packages),
    classCounts: countClasses(packages),
    copyleft: packages.filter((row: ReportPackage): boolean => row.licenseClass === 'weak-copyleft'),
    refused,
    policy: LICENSE_POLICY,
    vulnerabilities: input.vulnerabilities,
    advisories: reportAdvisories(input.vulnerabilities, packages),
    advisoryRecords: input.advisoryRecords,
    auditedAt: input.auditedAt,
    sbom: input.sbom,
    notices: groupNotices(input.notices, distributed),
    withoutNotice: [...distributed].filter((coordinate: string): boolean => !shipped.has(coordinate)).toSorted(byText),
  }
}

/** Where the compliance report is written unless the command names another directory. */
export const DEFAULT_REPORT_OUTPUT: string = 'dist/compliance'

/** The file name every report starts with, which is also how a stale one is recognised. */
export const REPORT_FILE_PREFIX: string = 'oss-compliance-report-'

const SHORT_COMMIT_LENGTH: number = 12
const NOT_A_NAME_CHARACTER: RegExp = /[^a-z0-9]+/u

/**
 * The report's file name without extension: the project and the commit it describes.
 * @param projectName the root manifest's name, which may be scoped.
 * @param commit the source commit.
 * @returns a name safe on every filesystem.
 */
export const reportFileStem = (projectName: string, commit: string): string => {
  const name: string = projectName
    .toLowerCase()
    .split(NOT_A_NAME_CHARACTER)
    .filter((part: string): boolean => part.length > 0)
    .join('-')
  return `${REPORT_FILE_PREFIX}${name.length > 0 ? name : 'project'}-${commit.slice(0, SHORT_COMMIT_LENGTH)}`
}

const OUTPUT_OPTION: string = '--output'

/**
 * Parse the compliance report command grammar: no argument, or one output directory.
 * @param arguments_ the arguments after the command name.
 * @returns the output directory, or undefined when the arguments are not that grammar.
 */
export const parseComplianceReportArguments = (
  arguments_: readonly string[],
): { readonly output: string } | undefined => {
  if (arguments_.length === 0) {
    return { output: DEFAULT_REPORT_OUTPUT }
  }
  const [option, value = '', ...extra] = arguments_
  if (option !== OUTPUT_OPTION || extra.length > 0) {
    return undefined
  }
  return value.length > 0 && !value.startsWith('-') ? { output: value } : undefined
}

const DECLARING_GROUPS: readonly string[] = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]

/**
 * The packages any workspace manifest declares, which is what makes a dependency direct.
 * @param manifests every workspace manifest, as parsed JSON.
 * @returns the declared package names, each once.
 */
export const directDependencyNames = (manifests: readonly unknown[]): readonly string[] => [
  ...new Set(
    manifests.flatMap((manifest: unknown): readonly string[] =>
      DECLARING_GROUPS.flatMap((group: string): readonly string[] => Object.keys(asRecord(readKey(manifest, group)))),
    ),
  ),
]
