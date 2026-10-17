// Render the open source software report as one self-contained HTML document: no external asset, so the file is
// the whole deliverable whether it is opened offline, attached to a message, or printed to PDF.

import type { ComplianceReport, LicenseCount, NoticeGroup, ReportAdvisory, ReportPackage } from './compliance-report.js'
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
  nowrap,
  packageLink,
  paragraphs,
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
import type { Advisory } from './vulnerability-policy.js'

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

type Outcome = 'pass' | 'fail'

const statement = (outcome: Outcome, text: string): string => `<li class="${outcome}">${text}</li>`

const verdictOf = (isPassing: boolean): Outcome => (isPassing ? 'pass' : 'fail')

// The verb that agrees with a counted subject: "1 package version has", "2 package versions have".
const agreeing = (count: number, one: string, several: string): string => (count === 1 ? one : several)

const severityOf = (entry: ReportAdvisory): string => entry.advisory.severity.toLowerCase()

const countAt = (entries: readonly ReportAdvisory[], severity: string): number =>
  entries.filter((entry: ReportAdvisory): boolean => severityOf(entry) === severity).length

// "1 high, 2 low", most severe first, which is the order the advisories are already listed in.
const severityBreakdown = (entries: readonly ReportAdvisory[]): string =>
  [...new Set(entries.map((entry: ReportAdvisory): string => severityOf(entry)))]
    .map((severity: string): string => `${formatCount(countAt(entries, severity))} ${escapeHtml(severity)}`)
    .join(', ')

const licenseStatement = (report: ComplianceReport): string => {
  const outside: number = report.classCounts.refused
  return statement(
    verdictOf(outside === 0),
    outside === 0
      ? `All ${plural(report.packages.length, 'package version')} have a license within the policy.`
      : `${plural(outside, 'package version')} ${agreeing(outside, 'has', 'have')} a license outside the policy. ` +
          `Each is listed in ${sectionReference('review-outside')}.`,
  )
}

const openStatement = (report: ComplianceReport, mitigatedCount: number): string => {
  const open: readonly ReportAdvisory[] = report.advisories.filter(
    (entry: ReportAdvisory): boolean => entry.mitigation === undefined,
  )
  if (open.length > 0) {
    return statement(
      'fail',
      `${plural(open.length, 'vulnerability', 'vulnerabilities')} (${severityBreakdown(open)}) ` +
        `${agreeing(open.length, 'is', 'are')} open, with no mitigation plan. ` +
        `Each is listed in ${sectionReference('advisories-all')}.`,
    )
  }
  return statement('pass', mitigatedCount === 0 ? 'No known vulnerabilities.' : 'No open vulnerabilities.')
}

const vulnerabilityStatements = (report: ComplianceReport): readonly string[] => {
  const mitigated: readonly ReportAdvisory[] = report.advisories.filter(
    (entry: ReportAdvisory): boolean => entry.mitigation !== undefined,
  )
  const stale: number = report.vulnerabilities.deadEntries.length
  return [
    openStatement(report, mitigated.length),
    ...(mitigated.length > 0
      ? [
          statement(
            'pass',
            `${plural(mitigated.length, 'vulnerability', 'vulnerabilities')} (${severityBreakdown(mitigated)}) ` +
              `${agreeing(mitigated.length, 'is mitigated, with a', 'are mitigated, each with a')} ` +
              `mitigation plan in ${sectionReference('advisories-plans')}.`,
          ),
        ]
      : []),
    ...(stale > 0
      ? [
          statement(
            'fail',
            `${plural(stale, 'recorded mitigation')} ${agreeing(stale, 'matches', 'match')} no current ` +
              `vulnerability. Each is listed in ${sectionReference('advisories-stale')}.`,
          ),
        ]
      : []),
  ]
}

const verdict = (report: ComplianceReport): string =>
  `<ul class="statements verdict">${[licenseStatement(report), ...vulnerabilityStatements(report)].join('')}</ul>`

const preamble = (report: ComplianceReport): string =>
  `<div id="preamble">${draftNotice(report)}${verdict(report)}${facts([
    ['Project', escapeHtml(report.projectName)],
    ...(report.projectDescription === undefined
      ? []
      : [['Description', escapeHtml(report.projectDescription)] as const]),
    ['Source commit', code(report.source.commit)],
    ['Report generated', escapeHtml(report.generatedAt)],
    ['Vulnerability data as of', escapeHtml(report.auditedAt)],
  ])}</div>`

// The verdict precedes the contents, so a reader who opens only the first page reads it.
const header = (report: ComplianceReport): string =>
  `<div id="header"><h1>Open Source Software Report</h1>${preamble(report)}${tableOfContents()}</div>`

const advisoryLink = (advisory: Advisory): string =>
  advisory.url?.startsWith('https://') === true
    ? `<a href="${escapeHtml(advisory.url)}" rel="noreferrer noopener">${nowrap(code(advisory.id))}</a>`
    : nowrap(code(advisory.id))

const aliasLine = (advisory: Advisory): string =>
  advisory.aliases.length > 0 ? `<br><span class="mono">${escapeHtml(advisory.aliases.join(', '))}</span>` : ''

const planId = (index: number): string => `plan-${String(index + 1)}`

const statusOf = (entry: ReportAdvisory, planIndex: number): string =>
  entry.mitigation === undefined
    ? '<span class="chip status-open">Open</span>'
    : `<a class="plain" href="#${planId(planIndex)}"><span class="chip status-mitigated">Mitigated</span></a>`

const ADVISORY_HEADINGS: readonly string[] = ['Severity', 'Advisory', 'Package', 'Scope', 'Status']

const advisoryRow = (entry: ReportAdvisory, mitigated: readonly ReportAdvisory[]): string => {
  const status: string = statusOf(entry, mitigated.indexOf(entry))
  return cells([
    severityChip(entry.advisory.severity),
    `${advisoryLink(entry.advisory)}${aliasLine(entry.advisory)}<br>${escapeHtml(entry.advisory.title)}`,
    escapeHtml(entry.advisory.packageName),
    nowrap(entry.isProduction ? 'Production' : 'Development'),
    nowrap(status),
  ])
}

const plan = (entry: ReportAdvisory, index: number): string => {
  const addedOn: string = escapeHtml(entry.mitigation?.addedOn ?? '')
  const recorded: string =
    `<span class="mono">${nowrap(addedOn)}</span>` + (entry.isHarnessMitigation ? ' by the build harness' : '')
  return (
    `<div class="plan" id="${planId(index)}"><p class="title">${severityChip(entry.advisory.severity)} ` +
    `${nowrap(code(entry.advisory.id))} in ${escapeHtml(entry.advisory.packageName)}</p>` +
    `<p class="plan-subject">${escapeHtml(entry.advisory.title)}</p>` +
    facts(
      [
        ['Why it can&#39;t be exploited here', escapeHtml(entry.mitigation?.reason ?? '')],
        ['Mitigation plan', escapeHtml(entry.mitigation?.mitigation ?? '')],
        ['Recorded', recorded],
      ],
      'plan',
    ) +
    '</div>'
  )
}

const listItem = (text: string): string => `<li>${escapeHtml(text)}</li>`

const staleMitigations = (entries: readonly string[]): string =>
  entries.length > 0
    ? `<ul>${entries.map((entry: string): string => listItem(entry)).join('')}</ul>`
    : '<p class="empty">Every recorded mitigation matches a current vulnerability.</p>'

const vulnerabilities = (report: ComplianceReport): string => {
  const mitigated: readonly ReportAdvisory[] = report.advisories.filter(
    (entry: ReportAdvisory): boolean => entry.mitigation !== undefined,
  )
  return section(
    'vulnerabilities',
    paragraphs([
      'Every installed package, development tools included, was checked against the GitHub Advisory Database ' +
        `at ${escapeHtml(report.auditedAt)}.`,
      'Each vulnerability is either open, which fails the build, or mitigated, which means the project recorded ' +
        'why it can&#39;t be exploited here and a mitigation plan.',
    ]) +
      subheading('advisories-all') +
      table(
        ADVISORY_HEADINGS,
        report.advisories.map((entry: ReportAdvisory): string => advisoryRow(entry, mitigated)),
        'No known vulnerability was reported.',
      ) +
      subheading('advisories-plans') +
      (mitigated.length > 0
        ? mitigated.map((entry: ReportAdvisory, index: number): string => plan(entry, index)).join('')
        : '<p class="empty">No vulnerability needs a mitigation plan.</p>') +
      subheading('advisories-stale') +
      staleMitigations(report.vulnerabilities.deadEntries),
  )
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

const licenses = (report: ComplianceReport): string => {
  const total: number = report.packages.length
  return section(
    'licenses',
    paragraphs([
      `${plural(total, 'package version')} ${agreeing(total, 'is', 'are')} installed, ` +
        `${formatCount(report.productionCount)} in the production dependency graph and ` +
        `${formatCount(total - report.productionCount)} used only for development and build.`,
      `Each license is judged against the policy in ${sectionReference('policy')}.`,
    ]) +
      subheading('license-classes') +
      classStack(report) +
      subheading('common-licenses') +
      licenseBars(report) +
      subheading('review-weak-copyleft') +
      paragraphs([
        'The policy admits weak copyleft only for components used unmodified. Development components are build, ' +
          'test and analysis tools that aren&#39;t distributed with the application.',
      ]) +
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
}

const policy = (report: ComplianceReport): string =>
  section(
    'policy',
    paragraphs([
      'The build enforces this policy, rendered from the same definition the license check reads. A license is ' +
        'identified by its Software Package Data Exchange (SPDX) identifier. In a compound expression, an OR is ' +
        'satisfied by any admitted alternative, and an AND requires every part.',
    ]) +
      subheading('policy-permissive') +
      paragraphs([
        `The policy admits ${plural(report.policy.permissive.length, 'license')} with no copyleft obligation. ` +
          `Attribution, where the license requires it, is satisfied by ${sectionReference('notices')}.`,
      ]) +
      idList(report.policy.permissive) +
      subheading('policy-weak-copyleft') +
      paragraphs([
        `The policy admits ${plural(report.policy.weakCopyleft.length, 'license')} only for dependencies used ` +
          'unmodified. Their copyleft, whether file-level or library-level, doesn&#39;t extend to the ' +
          'project&#39;s own source when the component is used as published.',
      ]) +
      idList(report.policy.weakCopyleft) +
      subheading('policy-outside') +
      paragraphs([
        'Every other license is outside the policy, including strong copyleft such as the GNU General ' +
          'Public License, licenses that restrict the field of use, and any package whose license can&#39;t be ' +
          'resolved. A single such package fails the build.',
      ]),
  )

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
    paragraphs([
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
    ? paragraphs([
        'These production package versions ship no license file.',
        `Their declared license is listed in ${sectionReference('inventory')}, and no text is invented for them.`,
      ]) + idList(report.withoutNotice)
    : '<p class="empty">Every production package version ships a license file.</p>'

const notices = (report: ComplianceReport): string =>
  section(
    'notices',
    paragraphs([
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
    paragraphs([
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
      paragraphs([
        'The report covers every package the pnpm workspace resolves, for every workspace package, including ' +
          'development and build tools.',
        'A license is the one the installed package manifest declares.',
        'The embedded SBOM lists the same resolved set with its dependency graph.',
      ]),
  )

const body = (report: ComplianceReport, fileStem: string): readonly string[] => [
  vulnerabilities(report),
  licenses(report),
  policy(report),
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
    `<title>Open source software report - ${escapeHtml(report.projectName)}</title>`,
    `<style>${fontFaces(attachments.fonts)}${REPORT_STYLE}</style></head>`,
    '<body class="article toc2 toc-left">',
    header(report),
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
