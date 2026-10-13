// Render the compliance report as one self-contained HTML document: no external asset, so the file is
// the whole deliverable whether it is opened offline, attached to a message, or printed to PDF.

import type { ComplianceReport, LicenseCount, NoticeGroup, ReportPackage, SeverityCount } from './compliance-report.js'
import { type EmbeddedFont, fontFaces, REPORT_SCRIPT, REPORT_STYLE } from './compliance-report-assets.js'
import {
  admonition,
  CLASS_LABELS,
  CLASSES,
  cells,
  classChip,
  code,
  embeddedJson,
  escapeHtml,
  facts,
  formatCount,
  idList,
  inventoryCsv,
  lettered,
  nowrap,
  packageLink,
  percentOf,
  plural,
  relationLabel,
  scopeLabel,
  severityChip,
  table,
  versionLabel,
} from './compliance-report-markup.js'
import { section, sectionReference, subheading, tableOfContents } from './compliance-report-outline.js'
import type { LicenseClass } from './license-allowlist.js'
import type { Advisory, SuppressedAdvisory } from './vulnerability-policy.js'

/** What the report carries besides its own markup. */
export interface ReportAttachments {
  /** The CycloneDX document as written, so its SHA-256 matches the one the report prints. */
  readonly sbom: string
  /** The typefaces the report is set in, embedded so it reads the same on every machine. */
  readonly fonts: readonly EmbeddedFont[]
}

const SHORT_COMMIT: number = 12
const CHART_LICENSES: number = 10

const shortCommit = (commit: string): string => commit.slice(0, SHORT_COMMIT)

const draftNotice = (report: ComplianceReport): string =>
  report.draftReasons.length === 0
    ? ''
    : admonition(
        'warning',
        `<p>This report is a draft and must not be treated as release evidence. ${report.draftReasons
          .map((reason: string): string => escapeHtml(reason))
          .join(' ')}</p>`,
      )

const verdictNotice = (report: ComplianceReport): string => {
  const threshold: string = escapeHtml(report.vulnerabilities.threshold)
  return report.isCompliant
    ? admonition(
        'ok',
        '<p><strong>Compliant.</strong> Every dependency is licensed within the stated policy, and no known ' +
          `vulnerability at or above ${threshold} severity stands unresolved.</p>`,
      )
    : admonition(
        'fail',
        '<p><strong>Not compliant</strong>. At least one dependency is outside the license policy, or a known ' +
          `vulnerability at or above ${threshold} severity stands unresolved. The sections below name each one.</p>`,
      )
}

const header = (): string =>
  `<div id="header"><h1>Open Source Software Compliance Report</h1>${tableOfContents()}</div>`

const opening = (report: ComplianceReport): string =>
  `<div id="preamble">${draftNotice(report)}${verdictNotice(report)}${facts([
    ['Project', escapeHtml(report.projectName)],
    ...(report.projectDescription === undefined
      ? []
      : [['Description', escapeHtml(report.projectDescription)] as const]),
    ['Source commit', code(report.source.commit)],
    ['Report generated', escapeHtml(report.generatedAt)],
    ['Advisory data as of', escapeHtml(report.auditedAt)],
    ['Package versions', formatCount(report.packages.length)],
    ['Software bill of materials', `CycloneDX 1.6, ${plural(report.sbom.components, 'component')}`],
  ])}</div>`

const figure = (value: number, label: string, tone: string): string =>
  `<div class="figure ${tone}"><b>${formatCount(value)}</b><span>${escapeHtml(label)}</span></div>`

const toneOf = (count: number, whenPresent: string): string => (count > 0 ? whenPresent : 'good')

const keyFigures = (report: ComplianceReport): string => {
  const total: number = report.packages.length
  const open: number = report.vulnerabilities.unsuppressed.length
  const weak: number = report.classCounts['weak-copyleft']
  const refused: number = report.classCounts.refused
  return `<div class="figures">${[
    figure(total, 'package versions in the resolved set', 'plain'),
    figure(report.productionCount, 'in the production dependency graph', 'plain'),
    figure(total - report.productionCount, 'used only for development and build', 'plain'),
    figure(weak, 'under a weak copyleft license', toneOf(weak, 'warn')),
    figure(refused, 'licenses outside the policy', toneOf(refused, 'bad')),
    figure(open, `open vulnerabilities at or above ${report.vulnerabilities.threshold}`, toneOf(open, 'bad')),
  ].join('')}</div>`
}

const classStack = (report: ComplianceReport): string => {
  const total: number = report.packages.length
  const share = (licenseClass: LicenseClass): string => percentOf(report.classCounts[licenseClass], total)
  const description: string = CLASSES.map(
    (licenseClass: LicenseClass): string => `${CLASS_LABELS[licenseClass]} ${share(licenseClass)} percent`,
  ).join(', ')
  return (
    `<div class="stack" role="img" aria-label="${description}">${CLASSES.map(
      (licenseClass: LicenseClass): string =>
        `<i class="seg-${licenseClass}" style="width:${share(licenseClass)}%"></i>`,
    ).join('')}</div>` +
    `<ul class="legend">${CLASSES.map(
      (licenseClass: LicenseClass): string =>
        `<li class="key-${licenseClass}">${CLASS_LABELS[licenseClass]}: ` +
        `${formatCount(report.classCounts[licenseClass])} (${share(licenseClass)}%)</li>`,
    ).join('')}</ul>`
  )
}

const bar = (label: string, count: number, largest: number, tone: LicenseClass | 'other'): string =>
  `<span class="label">${escapeHtml(label)}</span><span class="track"><span class="fill fill-${tone}" ` +
  `style="width:${percentOf(count, largest)}%"></span></span><span class="count">${formatCount(count)}</span>`

const licenseBars = (report: ComplianceReport): string => {
  const shown: readonly LicenseCount[] = report.licenseCounts.slice(0, CHART_LICENSES)
  const rest: readonly LicenseCount[] = report.licenseCounts.slice(CHART_LICENSES)
  const largest: number = shown[0]?.count ?? 0
  const restCount: number = rest.reduce((sum: number, entry: LicenseCount): number => sum + entry.count, 0)
  return `<div class="bars">${[
    ...shown.map((entry: LicenseCount): string => bar(entry.license, entry.count, largest, entry.licenseClass)),
    ...(rest.length > 0 ? [bar(plural(rest.length, 'other license'), restCount, largest, 'other')] : []),
  ].join('')}</div>`
}

const severityRow = (counts: readonly SeverityCount[]): string =>
  `<ul class="severities">${counts
    .map((entry: SeverityCount): string => `<li>${severityChip(entry.severity)} ${formatCount(entry.count)}</li>`)
    .join('')}</ul>`

type Outcome = 'pass' | 'fail' | 'info'

const statement = (outcome: Outcome, text: string): string => `<li class="${outcome}">${text}</li>`

const verdictOf = (isPassing: boolean): Outcome => (isPassing ? 'pass' : 'fail')

const licenseFinding = (report: ComplianceReport): string =>
  statement(
    verdictOf(report.classCounts.refused === 0),
    report.classCounts.refused === 0
      ? `All ${plural(report.packages.length, 'package version')} declare a license the policy admits.`
      : `${plural(report.classCounts.refused, 'package version')} declare a license outside the policy.`,
  )

const vulnerabilityFindings = (report: ComplianceReport): readonly string[] => {
  const open: number = report.vulnerabilities.unsuppressed.length
  const threshold: string = escapeHtml(report.vulnerabilities.threshold)
  const excused: number = report.vulnerabilities.suppressed.length
  const stale: number = report.vulnerabilities.deadEntries.length
  const excusedVerb: string = excused === 1 ? 'is' : 'are'
  return [
    statement(
      verdictOf(open === 0),
      open === 0
        ? `No known vulnerability at or above ${threshold} severity stands unresolved across ` +
            `${plural(report.advisoryRecords, 'advisory record')}.`
        : `${plural(open, 'known vulnerability', 'known vulnerabilities')} at or above ${threshold} severity ` +
            'stand unresolved.',
    ),
    statement(
      verdictOf(stale === 0),
      stale === 0
        ? `${plural(excused, 'advisory', 'advisories')} at or above the threshold ${excusedVerb} excused by a ` +
            'recorded, justified and dated exception.'
        : `${plural(stale, 'recorded exception')} no longer match any finding.`,
    ),
  ]
}

const noticeFinding = (report: ComplianceReport): string =>
  statement(
    'info',
    `${plural(report.notices.length, 'distinct license text')} reproduced for the production dependencies.` +
      (report.withoutNotice.length === 0
        ? ''
        : ` ${plural(report.withoutNotice.length, 'production package version')} ship no license file and are ` +
          `attributed by their declared license in ${sectionReference('inventory')}.`),
  )

const findings = (report: ComplianceReport): string =>
  `<ul class="statements">${[
    licenseFinding(report),
    statement(
      'info',
      `${plural(report.classCounts['weak-copyleft'], 'package version')} carry a weak copyleft license. Each is ` +
        `listed with its scope in ${sectionReference('copyleft')}.`,
    ),
    ...vulnerabilityFindings(report),
    noticeFinding(report),
  ].join('')}</ul>`

const summary = (report: ComplianceReport): string =>
  section(
    'summary',
    lettered([
      'This section states what the report establishes, in one view.',
      'Every figure is computed from the installed dependency tree of the source commit named above, with the ' +
        'same data the project build uses to pass or fail.',
    ]) +
      subheading('key-figures') +
      keyFigures(report) +
      subheading('license-classes') +
      classStack(report) +
      subheading('common-licenses') +
      licenseBars(report) +
      subheading('severities') +
      severityRow(report.severityCounts) +
      subheading('findings') +
      findings(report),
  )

const policy = (report: ComplianceReport): string =>
  section(
    'policy',
    lettered([
      'This section states the policy the build enforces, rendered from the same definition the license check reads.',
      'A license is identified by its Software Package Data Exchange (SPDX) identifier.',
      'In a compound expression, an OR is satisfied by any admitted alternative, because the recipient may choose ' +
        'it, and an AND requires every part.',
    ]) +
      subheading('policy-permissive') +
      lettered([
        `The policy admits ${plural(report.policy.permissive.length, 'license')} with no copyleft obligation.`,
        `Attribution, where the license requires it, is satisfied by ${sectionReference('notices')}.`,
      ]) +
      idList(report.policy.permissive) +
      subheading('policy-weak-copyleft') +
      lettered([
        `The policy admits ${plural(report.policy.weakCopyleft.length, 'license')} only for dependencies used ` +
          'unmodified.',
        'File-level copyleft, as in the Mozilla, Eclipse, and Common Development and Distribution licenses, ' +
          'doesn&#39;t extend to the project&#39;s own source when the component is used as published.',
        'Neither does library-level copyleft, as in the GNU Lesser General Public License.',
      ]) +
      idList(report.policy.weakCopyleft) +
      subheading('policy-outside') +
      lettered([
        'Every other license is outside the policy, including strong copyleft such as the GNU General ' +
          'Public License and the GNU Affero General Public License, licenses that restrict the field of use, and ' +
          'any package whose license can&#39;t be resolved.',
        'A single such package fails the build.',
      ]),
  )

const REVIEW_HEADINGS: readonly string[] = ['Package', 'Version', 'License', 'Scope', 'Relation']

const reviewRow = (row: ReportPackage): string => {
  const version: string = nowrap(escapeHtml(versionLabel(row)))
  return cells([
    packageLink(row),
    `<span class="mono">${version}</span>`,
    code(row.license),
    nowrap(scopeLabel(row)),
    nowrap(relationLabel(row)),
  ])
}

const copyleft = (report: ComplianceReport): string =>
  section(
    'copyleft',
    lettered([
      'This section lists every package version whose license carries any copyleft condition.',
      'The policy admits weak copyleft only for components used unmodified.',
      'Production components are part of the distributed application. Development components are build, test and ' +
        'analysis tools that aren&#39;t distributed with it.',
    ]) +
      subheading('review-weak-copyleft') +
      table(
        REVIEW_HEADINGS,
        report.copyleft.map((row: ReportPackage): string => reviewRow(row)),
        'No dependency carries a weak copyleft license.',
      ) +
      subheading('review-outside') +
      table(
        REVIEW_HEADINGS,
        report.refused.map((row: ReportPackage): string => reviewRow(row)),
        'No dependency declares a license outside the policy.',
      ),
  )

const advisoryLink = (advisory: Advisory): string =>
  advisory.url?.startsWith('https://') === true
    ? `<a href="${escapeHtml(advisory.url)}" rel="noreferrer noopener">${nowrap(code(advisory.id))}</a>`
    : nowrap(code(advisory.id))

const aliasLine = (advisory: Advisory): string =>
  advisory.aliases.length > 0 ? `<br><span class="mono">${escapeHtml(advisory.aliases.join(', '))}</span>` : ''

const advisoryCells = (advisory: Advisory): readonly string[] => [
  severityChip(advisory.severity),
  `${advisoryLink(advisory)}${aliasLine(advisory)}<br>${escapeHtml(advisory.title)}`,
  escapeHtml(advisory.packageName),
]

const ADVISORY_HEADINGS: readonly string[] = ['Severity', 'Advisory', 'Package']

const excusedRow = (entry: SuppressedAdvisory): string =>
  cells([
    ...advisoryCells(entry.advisory),
    escapeHtml(entry.exception.reason) +
      (entry.isHarnessException ? '<br><span class="empty">Recorded by the build harness.</span>' : ''),
    `<span class="mono">${nowrap(escapeHtml(entry.exception.addedOn))}</span>`,
  ])

const listItem = (text: string): string => `<li>${escapeHtml(text)}</li>`

const staleExceptions = (entries: readonly string[]): string =>
  entries.length > 0
    ? `<ul>${entries.map((entry: string): string => listItem(entry)).join('')}</ul>`
    : '<p class="empty">Every recorded exception still matches a finding.</p>'

const vulnerabilityIntroduction = (report: ComplianceReport): string =>
  lettered([
    'Every package in the resolved set, development tools included, was checked against the npm registry ' +
      'advisory service, which publishes the GitHub Advisory Database.',
    `The query ran at ${escapeHtml(report.auditedAt)} and returned ` +
      `${plural(report.advisoryRecords, 'advisory record')}.`,
    `The build fails on any advisory at or above <strong>${escapeHtml(report.vulnerabilities.threshold)}</strong> ` +
      'severity unless a recorded exception explains why the project can&#39;t reach it.',
    'Unlike the rest of this report, this section reflects the database at the time of the query and can change ' +
      'for the same source.',
  ])

const vulnerabilities = (report: ComplianceReport): string => {
  const { threshold, unsuppressed, suppressed, belowThreshold, deadEntries } = report.vulnerabilities
  return section(
    'vulnerabilities',
    vulnerabilityIntroduction(report) +
      subheading('advisories-open') +
      table(
        ADVISORY_HEADINGS,
        unsuppressed.map((advisory: Advisory): string => cells(advisoryCells(advisory))),
        `No advisory at or above ${threshold} severity stands unresolved.`,
      ) +
      subheading('advisories-excused') +
      table(
        [...ADVISORY_HEADINGS, "Why it isn't reachable", 'Recorded'],
        suppressed.map((entry: SuppressedAdvisory): string => excusedRow(entry)),
        'No exception is in use.',
      ) +
      subheading('advisories-stale') +
      staleExceptions(deadEntries) +
      subheading('advisories-below') +
      table(
        ADVISORY_HEADINGS,
        belowThreshold.map((advisory: Advisory): string => cells(advisoryCells(advisory))),
        'No advisory below the threshold was reported.',
      ),
  )
}

const inventoryRow = (row: ReportPackage): string =>
  `<tr data-scope="${row.isProduction ? 'production' : 'development'}" data-class="${row.licenseClass}">` +
  `<td>${packageLink(row)}</td><td class="mono nowrap">${escapeHtml(versionLabel(row))}</td>` +
  `<td>${code(row.license)}</td><td>${classChip(row.licenseClass)}</td>` +
  `<td class="nowrap">${scopeLabel(row)}</td><td class="nowrap">${relationLabel(row)}</td></tr>`

const classOption = (licenseClass: LicenseClass): string =>
  `<option value="${licenseClass}">${CLASS_LABELS[licenseClass]}</option>`

const inventoryControls = (fileStem: string): string =>
  '<div class="downloads">' +
  `<button type="button" data-download="sbom" data-file="${escapeHtml(fileStem)}.cdx.json" hidden>` +
  'Download SBOM (CycloneDX JSON)</button>' +
  `<button type="button" data-download="csv" data-file="${escapeHtml(fileStem)}.csv" hidden>` +
  'Download inventory (CSV)</button></div>' +
  '<div class="controls">' +
  '<input id="filter-text" type="search" placeholder="Filter by package or license" ' +
  'aria-label="Filter by package or license">' +
  '<select id="filter-scope" aria-label="Scope"><option value="">All scopes</option>' +
  '<option value="production">Production</option><option value="development">Development</option></select>' +
  '<select id="filter-class" aria-label="License class"><option value="">All license classes</option>' +
  CLASSES.map((licenseClass: LicenseClass): string => classOption(licenseClass)).join('') +
  '</select><output id="filter-count" aria-live="polite"></output></div>'

const INVENTORY_HEADINGS: readonly string[] = ['Package', 'Version', 'License', 'Class', 'Scope', 'Relation']

const inventory = (report: ComplianceReport, fileStem: string): string =>
  section(
    'inventory',
    lettered([
      `This section lists every installed package version, ${plural(report.packages.length, 'row')}, with the ` +
        'license its installed manifest declares.',
      'Scope is production when the version is reachable from a production dependency of any workspace package, ' +
        'and development otherwise.',
      'Relation is direct when a workspace manifest declares the package by name.',
    ]) +
      inventoryControls(fileStem) +
      '<div class="table-wrap"><table class="tableblock" id="inventory-table"><thead><tr>' +
      INVENTORY_HEADINGS.map((heading: string): string => `<th scope="col" data-sort>${heading}</th>`).join('') +
      `</tr></thead><tbody>${report.packages.map((row: ReportPackage): string => inventoryRow(row)).join('')}` +
      '</tbody></table></div>',
  )

const LICENSE_HEADING: RegExp = /^#{1,6}[ \t]+/u
const LICENSE_RULE: RegExp = /^[-=_*~]{3,}$/u
// A web or e-mail address cannot break between words, and a copyright statement is a short line of names,
// so justifying either opens wide gaps. Such a paragraph is set flush left instead.
const FLUSH_LEFT: RegExp = /\b(?:https?:\/\/|www\.)\S{20}|<[^<>\s]{1,80}@[^<>\s]{1,80}>|^(?:\(c\)|copyright\b|\u{A9})/iu

// A licence block is plain lines, except that a bundle of licences titles each one with a Markdown heading
// and separates them with a ruled line. Those two are drawn as what they are, not printed as characters.
const licenseLine = (line: string): string => {
  if (LICENSE_RULE.test(line)) {
    return '<hr>'
  }
  return LICENSE_HEADING.test(line)
    ? `<p class="license-heading">${escapeHtml(line.replace(LICENSE_HEADING, ''))}</p>`
    : `<p>${escapeHtml(line)}</p>`
}

const licenseBlock = (block: string): string => {
  const lines: readonly string[] = block.split('\n')
  const isStructured: boolean = lines.some(
    (line: string): boolean => LICENSE_RULE.test(line) || LICENSE_HEADING.test(line),
  )
  const alignment: string = FLUSH_LEFT.test(block) ? ' class="ragged"' : ''
  return isStructured
    ? `<div class="license-entry">${lines.map((line: string): string => licenseLine(line)).join('')}</div>`
    : `<p${alignment}>${lines.map((line: string): string => escapeHtml(line)).join('<br>')}</p>`
}

// The package is what a reader looks for, so it heads the entry. The file names follow, with the number of
// package versions that share the text when there is more than one.
const noticeSource = (group: NoticeGroup): string =>
  escapeHtml(group.fileNames.join(', ')) +
  (group.coordinates.length > 1 ? `, shared by ${plural(group.coordinates.length, 'package version')}` : '')

const noticeGroup = (group: NoticeGroup, index: number): string =>
  `<div class="notice" id="notice-${String(index + 1)}">` +
  `<p class="title">${escapeHtml(group.coordinates.join(', '))}</p>` +
  `<p class="notice-packages">${noticeSource(group)}</p>` +
  `<div class="license-text">${group.text
    .split('\n\n')
    .map((block: string): string => licenseBlock(block))
    .join('')}</div></div>`

const missingNotices = (report: ComplianceReport): string =>
  report.withoutNotice.length > 0
    ? lettered([
        'These production package versions ship no license file.',
        `Their declared license is listed in ${sectionReference('inventory')}, and no text is invented for them.`,
      ]) + idList(report.withoutNotice)
    : '<p class="empty">Every production package version ships a license file.</p>'

const notices = (report: ComplianceReport): string =>
  section(
    'notices',
    lettered([
      'This section reproduces the license and notice files shipped by each production dependency, from the ' +
        'installed package.',
      'The words are unchanged. Only the fixed-width line breaks and the Markdown markers of the original files ' +
        'are removed so the text reads as paragraphs.',
      'Identical texts are printed once with every package version that ships them.',
      'Development dependencies aren&#39;t distributed with the application, so this section doesn&#39;t ' +
        'reproduce them.',
    ]) +
      subheading('notices-missing') +
      missingNotices(report) +
      subheading('notices-texts') +
      (report.notices.length > 0
        ? report.notices.map((group: NoticeGroup, index: number): string => noticeGroup(group, index)).join('')
        : '<p class="empty">No production dependency ships a license file.</p>'),
  )

// A digest is read as one value, so it is set in the code face without a chip, which would split in two
// where the value wraps.
const digest = (value: string): string => `<span class="digest">${escapeHtml(value)}</span>`

const provenance = (report: ComplianceReport): string =>
  section(
    'provenance',
    lettered([
      'This report is generated by the build, not written by hand.',
      'It reads the same installed dependency tree, license policy and advisory data that the license and ' +
        'vulnerability checks of the build use to pass or fail, so the report and the verdict can&#39;t disagree.',
      'Anyone with the repository can regenerate it from the commit below.',
    ]) +
      subheading('provenance-source') +
      facts([
        ['Source commit', code(report.source.commit)],
        ['Uncommitted changes', report.source.isDirty ? 'Present, so this report is a draft' : 'None'],
        ['Source fingerprint (SHA-256)', digest(report.source.fingerprint)],
        ['Lockfile (SHA-256)', digest(report.source.lockfileSha256)],
        ['SBOM (SHA-256)', digest(report.sbom.sha256)],
        ['SBOM generator', digest(report.sbom.generator)],
        ['Report date', escapeHtml(report.generatedAt)],
        ['Regenerate', code('pnpm exec ploaness compliance-report')],
      ]) +
      subheading('provenance-scope') +
      lettered([
        'The report covers every package the pnpm workspace resolves, for every workspace package, including ' +
          'development and build tools.',
        'A license is the one the installed package manifest declares.',
        'The embedded SBOM lists the same resolved set with its dependency graph.',
      ]),
  )

const body = (report: ComplianceReport, fileStem: string): readonly string[] => [
  opening(report),
  summary(report),
  policy(report),
  copyleft(report),
  vulnerabilities(report),
  inventory(report, fileStem),
  notices(report),
  provenance(report),
]

/**
 * Render the compliance report as one self-contained HTML document.
 * @param report the assembled report.
 * @param attachments the exact bytes the report carries, and the typefaces it is set in.
 * @param fileStem the file name, without extension, downloads are offered under.
 * @returns the complete document.
 */
export const renderComplianceReport = (
  report: ComplianceReport,
  attachments: ReportAttachments,
  fileStem: string,
): string =>
  [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Open source compliance report - ${escapeHtml(report.projectName)}</title>`,
    `<style>${fontFaces(attachments.fonts)}${REPORT_STYLE}</style></head>`,
    '<body class="article toc2 toc-left">',
    header(),
    '<div id="content">',
    ...body(report, fileStem),
    '</div>',
    `<div id="footer">Report for ${escapeHtml(report.projectName)} at commit ` +
      `${code(shortCommit(report.source.commit))}, ${escapeHtml(report.generatedAt)}.</div>`,
    `<script type="application/json" id="report-data">${embeddedJson({
      sbom: attachments.sbom,
      csv: inventoryCsv(report.packages),
    })}</script>`,
    `<script>${REPORT_SCRIPT}</script>`,
    '</body></html>',
    '',
  ].join('\n')
