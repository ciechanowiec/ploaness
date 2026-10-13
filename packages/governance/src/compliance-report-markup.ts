// Small markup builders the compliance report is assembled from. Every value that reaches the document
// from a registry, a manifest or a licence file passes through `escapeHtml` here.
import type { ReportPackage } from './compliance-report.js'
import type { LicenseClass } from './license-allowlist.js'

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Escape text for an HTML text node or a quoted attribute.
 * @param text untrusted text, such as a package name or a licence file.
 * @returns the text with every markup character replaced by its entity.
 */
export const escapeHtml = (text: string): string =>
  text.replaceAll(/[&<>"']/gu, (character: string): string => HTML_ESCAPES[character] ?? character)

/** The label each licence class is printed with. */
export const CLASS_LABELS: Readonly<Record<LicenseClass, string>> = {
  permissive: 'Permissive',
  'weak-copyleft': 'Weak copyleft',
  refused: 'Outside policy',
}

/** Every licence class, from the least to the most restrictive. */
export const CLASSES: readonly LicenseClass[] = ['permissive', 'weak-copyleft', 'refused']

export const scopeLabel = (row: ReportPackage): string => (row.isProduction ? 'Production' : 'Development')
export const relationLabel = (row: ReportPackage): string => (row.isDirect ? 'Direct' : 'Transitive')
export const versionLabel = (row: ReportPackage): string => (row.version.length > 0 ? row.version : 'local directory')

const PERCENT: number = 100

export const percentOf = (count: number, total: number): string =>
  total === 0 ? '0' : ((count / total) * PERCENT).toFixed(1)

export const formatCount = (count: number): string => count.toLocaleString('en-US')

export const plural = (count: number, singular: string, several: string = `${singular}s`): string =>
  `${formatCount(count)} ${count === 1 ? singular : several}`

export const classChip = (licenseClass: LicenseClass): string =>
  `<span class="chip chip-${licenseClass}">${CLASS_LABELS[licenseClass]}</span>`

export const severityChip = (severity: string): string => {
  const escaped: string = escapeHtml(severity.toLowerCase())
  return `<span class="sev sev-${escaped}">${escaped}</span>`
}

export const nowrap = (html: string): string => `<span class="nowrap">${html}</span>`

export const code = (text: string): string => `<code>${escapeHtml(text)}</code>`

const cell = (value: string): string => `<td>${value}</td>`

export const cells = (values: readonly string[]): string =>
  `<tr>${values.map((value: string): string => cell(value)).join('')}</tr>`

/**
 * A ruled table, or a sentence saying it would be empty.
 * @param headings the column headings.
 * @param rows the rendered rows.
 * @param empty what to say when there are no rows.
 * @returns the table markup.
 */
export const table = (headings: readonly string[], rows: readonly string[], empty: string): string =>
  rows.length === 0
    ? `<p class="empty">${escapeHtml(empty)}</p>`
    : `<div class="table-wrap"><table class="tableblock"><thead><tr>${headings
        .map((heading: string): string => `<th scope="col">${escapeHtml(heading)}</th>`)
        .join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`

/**
 * A two-column table of labelled facts.
 * @param rows each label with its already rendered value.
 * @returns the table markup.
 */
export const facts = (rows: readonly (readonly [string, string])[]): string =>
  `<div class="table-wrap"><table class="tableblock facts"><tbody>${rows
    .map(
      ([label, value]: readonly [string, string]): string => `<tr><td>${escapeHtml(label)}</td><td>${value}</td></tr>`,
    )
    .join('')}</tbody></table></div>`

const WEB_LINK: RegExp = /^https?:\/\//u

export const packageLink = (row: ReportPackage): string =>
  row.homepage !== undefined && WEB_LINK.test(row.homepage)
    ? `<a href="${escapeHtml(row.homepage)}" rel="noreferrer noopener">${escapeHtml(row.name)}</a>`
    : escapeHtml(row.name)

const idItem = (id: string): string => `<li>${code(id)}</li>`

export const idList = (ids: readonly string[]): string =>
  `<ul class="ids">${ids.map((id: string): string => idItem(id)).join('')}</ul>`

const letteredItem = (html: string): string => `<li><p>${html}</p></li>`

/**
 * Statements set as a lettered list, the way every statement of the report is addressed.
 * @param items each statement, already rendered.
 * @returns the list markup.
 */
export const lettered = (items: readonly string[]): string =>
  `<div class="olist upperalpha"><ol class="upperalpha" type="A">${items
    .map((item: string): string => letteredItem(item))
    .join('')}</ol></div>`

/** The icon an admonition carries. */
export type AdmonitionKind = 'warning' | 'ok' | 'fail'

const ICON_PATHS: Readonly<Record<AdmonitionKind, string>> = {
  warning:
    'M12 2.5 1.5 21h21L12 2.5Zm-1.1 6.5h2.2l-.35 6.6h-1.5L10.9 9Zm1.1 10a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Z',
  ok: 'M12 1.5a10.5 10.5 0 1 0 0 21 10.5 10.5 0 0 0 0-21Zm-1.6 15.2-4.7-4.7 1.6-1.6 3.1 3.1 6.3-6.3 1.6 1.6-7.9 7.9Z',
  fail:
    'M12 1.5a10.5 10.5 0 1 0 0 21 10.5 10.5 0 0 0 0-21Zm-1.1 5h2.2l-.35 7.6h-1.5L10.9 6.5Zm1.1 11.6a1.3 1.3 0 1 1 ' +
    '0-2.6 1.3 1.3 0 0 1 0 2.6Z',
}

/**
 * A notice set apart from the text by an icon and a rule, where a reader looks first.
 * @param kind the icon.
 * @param html the notice, already rendered.
 * @returns the admonition markup.
 */
export const admonition = (kind: AdmonitionKind, html: string): string =>
  `<div class="admonitionblock ${kind}"><table><tbody><tr><td class="icon">` +
  `<svg class="icon-${kind}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" ` +
  `d="${ICON_PATHS[kind]}"/></svg></td><td class="content">${html}</td></tr></tbody></table></div>`

// Embedded data is JSON inside a script element; escaping `<` keeps a `</script>` in a licence file or a
// package name from ending the element early.
export const embeddedJson = (value: unknown): string => JSON.stringify(value).replaceAll('<', String.raw`\u003c`)

const CSV_FORMULA_START: RegExp = /^[=+\-@\t\r]/u

// Every field is quoted, and a field a spreadsheet would read as a formula is prefixed with an apostrophe:
// a package name is registry input, and a CSV opened in a spreadsheet is a place it could execute.
const csvField = (value: string): string => {
  const safe: string = CSV_FORMULA_START.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

/**
 * The package inventory as CSV, one row per installed package version.
 * @param packages the report's packages.
 * @returns the CSV text with a header row.
 */
export const inventoryCsv = (packages: readonly ReportPackage[]): string =>
  [
    ['package', 'version', 'license', 'license class', 'scope', 'relation', 'homepage'],
    ...packages.map((row: ReportPackage): readonly string[] => [
      row.name,
      row.version,
      row.license,
      CLASS_LABELS[row.licenseClass],
      scopeLabel(row),
      relationLabel(row),
      row.homepage ?? '',
    ]),
  ]
    .map((fields: readonly string[]): string => fields.map((field: string): string => csvField(field)).join(','))
    .join('\r\n')
    .concat('\r\n')
