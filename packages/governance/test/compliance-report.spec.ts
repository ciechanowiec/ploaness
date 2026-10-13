import { describe, expect, it } from 'vitest'
import {
  buildComplianceReport,
  type ComplianceReport,
  type ComplianceReportInput,
  DEFAULT_REPORT_OUTPUT,
  directDependencyNames,
  parseComplianceReportArguments,
  reflowLicenseText,
  reportFileStem,
} from '../src/compliance-report.js'
import { type ReportAttachments, renderComplianceReport } from '../src/compliance-report-html.js'
import { escapeHtml, inventoryCsv } from '../src/compliance-report-markup.js'
import { subheading } from '../src/compliance-report-outline.js'
import type { InventoryPackage } from '../src/license-inventory.js'
import type { Advisory, VulnerabilityClassification } from '../src/vulnerability-policy.js'

const inventoryPackage = (overrides: Partial<InventoryPackage> = {}): InventoryPackage => ({
  name: 'runtime-kit',
  versions: ['1.0.0'],
  license: 'MIT',
  paths: [],
  homepage: undefined,
  ...overrides,
})

const advisory = (overrides: Partial<Advisory> = {}): Advisory => ({
  id: 'GHSA-aaaa-bbbb-cccc',
  packageName: 'build-tool',
  severity: 'low',
  title: 'a minor defect',
  aliases: [],
  ...overrides,
})

const clean: VulnerabilityClassification = {
  threshold: 'moderate',
  unsuppressed: [],
  suppressed: [],
  belowThreshold: [advisory()],
  deadEntries: [],
}

const runtime: InventoryPackage = inventoryPackage({ homepage: 'https://example.invalid/runtime-kit' })
const shared: InventoryPackage = inventoryPackage({ name: 'shared', versions: ['2.0.0', '3.0.0'], license: 'ISC' })
const tool: InventoryPackage = inventoryPackage({ name: 'build-tool', versions: ['4.0.0'], license: 'LGPL-3.0-only' })
const local: InventoryPackage = inventoryPackage({ name: 'local-dir', versions: [], license: 'MPL-2.0' })

const input = (overrides: Partial<ComplianceReportInput> = {}): ComplianceReportInput => ({
  projectName: 'sample-app',
  projectDescription: undefined,
  source: { commit: 'a'.repeat(40), isDirty: false, fingerprint: 'f'.repeat(64), lockfileSha256: 'b'.repeat(64) },
  generatedAt: '2026-10-13T10:00:00.000Z',
  harnessVersion: '9.9.9',
  packages: [runtime, shared, tool, local],
  production: [runtime, inventoryPackage({ name: 'shared', versions: ['3.0.0'], license: 'ISC' }), local],
  directNames: ['runtime-kit', 'build-tool'],
  vulnerabilities: clean,
  advisoryRecords: 1,
  auditedAt: '2026-10-13T09:59:00.000Z',
  sbom: { sha256: 'c'.repeat(64), components: 5, generator: 'cdxgen' },
  notices: [
    { coordinate: 'runtime-kit@1.0.0', files: [{ name: 'LICENSE', text: 'MIT text\n' }] },
    { coordinate: 'shared@3.0.0', files: [{ name: 'LICENSE.md', text: '  MIT text' }] },
    { coordinate: 'build-tool@4.0.0', files: [{ name: 'COPYING', text: 'LGPL text' }] },
    { coordinate: 'local-dir', files: [] },
  ],
  ...overrides,
})

describe('compliance report model', () => {
  it('lists every installed version with its class, scope and relation', () => {
    const report: ComplianceReport = buildComplianceReport(input())
    expect(
      report.packages.map((row) => [row.name, row.version, row.licenseClass, row.isProduction, row.isDirect]),
    ).toEqual([
      ['build-tool', '4.0.0', 'weak-copyleft', false, true],
      ['local-dir', '', 'weak-copyleft', true, false],
      ['runtime-kit', '1.0.0', 'permissive', true, true],
      ['shared', '2.0.0', 'permissive', false, false],
      ['shared', '3.0.0', 'permissive', true, false],
    ])
    expect(report.productionCount).toBe(3)
    expect(report.directCount).toBe(2)
    expect(report.classCounts).toEqual({ permissive: 3, 'weak-copyleft': 2, refused: 0 })
    expect(report.licenseCounts.map((entry) => [entry.license, entry.count])).toEqual([
      ['ISC', 2],
      ['LGPL-3.0-only', 1],
      ['MIT', 1],
      ['MPL-2.0', 1],
    ])
    expect(report.copyleft.map((row) => row.name)).toEqual(['build-tool', 'local-dir'])
    expect(report.isCompliant).toBe(true)
    expect(report.draftReasons).toEqual([])
  })
  it('reproduces notices for the production graph only, once per identical text', () => {
    const report: ComplianceReport = buildComplianceReport(input())
    expect(report.notices).toEqual([
      { text: 'MIT text', fileNames: ['LICENSE', 'LICENSE.md'], coordinates: ['runtime-kit@1.0.0', 'shared@3.0.0'] },
    ])
    expect(report.withoutNotice).toEqual(['local-dir'])
  })
  it('counts advisories by severity from the most severe, keeping a severity the scale does not know', () => {
    const report: ComplianceReport = buildComplianceReport(
      input({
        vulnerabilities: {
          ...clean,
          unsuppressed: [advisory({ severity: 'Critical' }), advisory({ severity: 'urgent' })],
        },
      }),
    )
    expect(report.severityCounts).toEqual([
      { severity: 'urgent', count: 1 },
      { severity: 'critical', count: 1 },
      { severity: 'high', count: 0 },
      { severity: 'moderate', count: 0 },
      { severity: 'low', count: 1 },
      { severity: 'info', count: 0 },
    ])
  })
  it('is a draft and not compliant when the tree is dirty, a licence is refused or a finding stands', () => {
    expect(buildComplianceReport(input({ source: { ...input().source, isDirty: true } })).draftReasons).toEqual([
      expect.stringContaining('uncommitted changes'),
    ])
    const refused: ComplianceReport = buildComplianceReport(
      input({ packages: [inventoryPackage({ license: 'GPL-3.0-only' })] }),
    )
    expect(refused.isCompliant).toBe(false)
    expect(refused.refused.map((row) => row.license)).toEqual(['GPL-3.0-only'])
    expect(refused.draftReasons).toEqual([expect.stringContaining('satisfy the policy')])
    expect(buildComplianceReport(input({ vulnerabilities: { ...clean, deadEntries: ['stale'] } })).isCompliant).toBe(
      false,
    )
  })
})

// An advisory link the report must refuse to render: assembled so the spec carries no clear-text URL itself.
const CLEAR_TEXT_URL: string = ['http', 'insecure.invalid'].join('://')

const attachments: ReportAttachments = {
  sbom: '{"bomFormat":"CycloneDX"}\n',
  fonts: [{ family: 'Report Serif', style: 'normal', weight: '400 700', data: 'AAAA' }],
}

describe('compliance report document', () => {
  it('is one self-contained document with every section and the exact SBOM bytes', () => {
    const html: string = renderComplianceReport(buildComplianceReport(input()), attachments, 'report')
    expect(html.startsWith('<!doctype html>')).toBe(true)
    for (const id of ['summary', 'policy', 'copyleft', 'vulnerabilities', 'inventory', 'notices', 'provenance']) {
      expect(html).toContain(`id="${id}"`)
    }
    expect(html).not.toMatch(/<(?:link|img|iframe)\b|\bsrc=|@import|url\((?!data:)/u)
    expect(html.match(/href="[^"#][^"]*"/gu)).toEqual(['href="https://example.invalid/runtime-kit"'])
    const embedded: string = /<script type="application\/json" id="report-data">(.*?)<\/script>/su.exec(html)?.[1] ?? ''
    expect(JSON.parse(embedded)).toMatchObject({ sbom: attachments.sbom })
    expect(html).toContain('Compliant')
    expect(html).not.toContain('is a draft')
    const ids: readonly string[] = [...html.matchAll(/\bid="([^"]+)"/gu)].map((match) => match[1] ?? '')
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('escapes registry and licence text wherever it is printed or embedded', () => {
    const hostile: string = '</script><img src=x onerror=alert(1)>'
    const html: string = renderComplianceReport(
      buildComplianceReport(
        input({
          projectName: hostile,
          packages: [inventoryPackage({ name: hostile, license: hostile, homepage: 'javascript:alert(1)' })],
          production: [inventoryPackage({ name: hostile })],
          notices: [{ coordinate: `${hostile}@1.0.0`, files: [{ name: hostile, text: hostile }] }],
          vulnerabilities: {
            ...clean,
            unsuppressed: [advisory({ title: hostile, url: CLEAR_TEXT_URL })],
            suppressed: [
              {
                advisory: advisory({ id: 'GHSA-x', url: 'https://github.com/advisories/GHSA-x', aliases: ['CVE-1'] }),
                exception: { advisory: 'GHSA-x', reason: hostile, addedOn: '2026-01-01' },
                isHarnessException: true,
              },
            ],
            deadEntries: [hostile],
          },
        }),
      ),
      { sbom: hostile, fonts: [] },
      'report',
    )
    expect(html).not.toContain('<img')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain(CLEAR_TEXT_URL)
    expect(html.match(/<\/script>/gu)).toHaveLength(2)
    expect(html).toContain('This report is a draft and must not be treated as release evidence.')
    expect(html).toContain('Not compliant')
    expect(html).toContain('Recorded by the build harness.')
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
  it('states the empty cases rather than printing empty tables', () => {
    const html: string = renderComplianceReport(
      buildComplianceReport(
        input({ packages: [runtime], production: [], notices: [], vulnerabilities: { ...clean, belowThreshold: [] } }),
      ),
      attachments,
      'report',
    )
    expect(html).toContain('No dependency carries a weak copyleft license.')
    expect(html).toContain('No exception is in use.')
    expect(html).toContain('No production dependency ships a license file.')
  })
  it('folds the long tail of licences into one bar', () => {
    const many: readonly InventoryPackage[] = Array.from({ length: 12 }, (_unused: unknown, index: number) =>
      inventoryPackage({ name: `p${String(index)}`, license: index % 2 === 0 ? `BSD-${String(index)}-Clause` : 'MIT' }),
    )
    const html: string = renderComplianceReport(buildComplianceReport(input({ packages: many })), attachments, 'r')
    expect(html).toContain('other license')
  })
})

describe('inventory CSV', () => {
  it('quotes every field and neutralises spreadsheet formulas', () => {
    const csv: string = inventoryCsv(
      buildComplianceReport(input({ packages: [inventoryPackage({ name: '=HYPERLINK("x")', license: 'MIT' })] }))
        .packages,
    )
    expect(csv.split('\r\n')).toEqual([
      '"package","version","license","license class","scope","relation","homepage"',
      `"'=HYPERLINK(""x"")","1.0.0","MIT","Permissive","Development","Transitive",""`,
      '',
    ])
  })
})

describe('compliance report command and naming', () => {
  it('accepts no argument or one output directory', () => {
    expect(parseComplianceReportArguments([])).toEqual({ output: DEFAULT_REPORT_OUTPUT })
    expect(parseComplianceReportArguments(['--output', 'out/report'])).toEqual({ output: 'out/report' })
    expect(parseComplianceReportArguments(['--output'])).toBeUndefined()
    expect(parseComplianceReportArguments(['--output', '--verbose'])).toBeUndefined()
    expect(parseComplianceReportArguments(['--output', 'a', 'b'])).toBeUndefined()
    expect(parseComplianceReportArguments(['--format', 'pdf'])).toBeUndefined()
  })
  it('names the file after the project and the commit, safely for any filesystem', () => {
    expect(reportFileStem('@Scope/Web App', 'abcdef0123456789')).toBe(
      'oss-compliance-report-scope-web-app-abcdef012345',
    )
    expect(reportFileStem('@@', 'abc')).toBe('oss-compliance-report-project-abc')
  })
  it('collects every name any workspace manifest declares, once', () => {
    expect(
      directDependencyNames([
        { dependencies: { next: '16.0.0' }, devDependencies: { vitest: '4.0.0' } },
        { peerDependencies: { react: '19.0.0' }, optionalDependencies: { next: '16.0.0' } },
        'not a manifest',
      ]),
    ).toEqual(['next', 'vitest', 'react'])
  })
})

// The report's own sentences, with markup, styles, scripts, entities and license texts removed. Data a
// project supplies, such as an exception's reason, is quoted rather than written by the report.
const withoutElements = (html: string, open: string, close: string): string => {
  const start: number = html.indexOf(open)
  const end: number = start === -1 ? -1 : html.indexOf(close, start)
  return end === -1 ? html : withoutElements(`${html.slice(0, start)} ${html.slice(end + close.length)}`, open, close)
}

const reportProse = (html: string): string =>
  withoutElements(
    withoutElements(withoutElements(html, '<script', '</script>'), '<style', '</style>'),
    '<div class="license-text">',
    '</div>',
  )
    .split('<')
    .map((part: string): string => part.slice(part.indexOf('>') + 1))
    .join(' ')
    .replaceAll(/&#?\w+;/gu, ' ')

describe('compliance report typesetting', () => {
  it('writes its own prose without a semicolon', () => {
    const html: string = renderComplianceReport(
      buildComplianceReport(
        input({
          source: { ...input().source, isDirty: true },
          packages: [...input().packages, inventoryPackage({ name: 'gpl', license: 'GPL-3.0-only' })],
          vulnerabilities: { ...clean, unsuppressed: [advisory({ severity: 'high' })], deadEntries: ['GHSA-gone'] },
        }),
      ),
      attachments,
      'report',
    )
    expect(reportProse(html)).not.toContain(';')
  })
  it('refuses a heading the outline does not define', () => {
    expect(() => subheading('undefined-section')).toThrow('the report outline has no entry "undefined-section"')
  })
  it('embeds every typeface and numbers the outline the contents list repeats', () => {
    const html: string = renderComplianceReport(buildComplianceReport(input()), attachments, 'report')
    expect(html).toContain('@font-face{font-family:"Report Serif";font-style:normal;font-weight:400 700;')
    expect(html).toContain('url(data:font/woff2;base64,AAAA)')
    expect(html).toContain('<h2 id="vulnerabilities-title"><span class="adnum">4.</span>')
    expect(html).toContain('<a href="#advisories-excused"><span class="adnum">4.2.</span>')
    expect(html).toContain('<h3 id="advisories-excused"><span class="adnum">4.2.</span>')
    expect(html).not.toContain('Generated by')
  })
})

describe('license text reflow', () => {
  it('joins fixed-width lines into paragraphs and keeps list items and copyright lines apart', () => {
    const shipped: string = [
      'MIT License\r\n\r\nCopyright (c) 2020 One\nCopyright (c) 2021 Two\n\n',
      'Permission is hereby\n   granted,  free of\ncharge, non-\nexclusive.\n\n',
      '  * Redistributions must\n    retain this.\n  * Binary forms must\n    reproduce it.\n\n\n',
    ].join('')
    expect(reflowLicenseText(shipped)).toBe(
      [
        'MIT License\n\nCopyright (c) 2020 One\nCopyright (c) 2021 Two\n\n',
        'Permission is hereby granted, free of charge, non-exclusive.\n\n',
        '* Redistributions must retain this.\n* Binary forms must reproduce it.',
      ].join(''),
    )
  })
  it('keeps headings and separators apart and lets a sentence wrap before Copyright Holder', () => {
    expect(
      reflowLicenseText(
        '-----\nSIL OPEN FONT LICENSE\n-----\n\nPREAMBLE\nThe goals are\nstated here.\n\n' +
          'Permission is granted by the corresponding\nCopyright Holder of the work.\n\n\u{A9} 2020 Three',
      ),
    ).toBe(
      '-----\nSIL OPEN FONT LICENSE\n-----\n\nPREAMBLE\nThe goals are stated here.\n\n' +
        'Permission is granted by the corresponding Copyright Holder of the work.\n\n\u{A9} 2020 Three',
    )
  })
  it('reads a Markdown bundle of licences as headings, fields and quoted paragraphs', () => {
    const bundled: string = [
      '## quansync\nLicense: MIT\nBy: Anthony Fu\nRepository: git+https://example.invalid/quansync.git\n\n',
      '> MIT License\n>\n> Copyright (c) 2025 Anthony Fu\n>\n> Permission is hereby granted, free\n',
      '> of charge, to any person.\n\n---------------------------------------',
    ].join('')
    expect(reflowLicenseText(bundled)).toBe(
      [
        '## quansync\nLicense: MIT\nBy: Anthony Fu\nRepository: git+https://example.invalid/quansync.git\n\n',
        'MIT License\n\nCopyright (c) 2025 Anthony Fu\n\nPermission is hereby granted, free of charge, to any ',
        'person.\n\n---------------------------------------',
      ].join(''),
    )
  })
  it('ends a Markdown heading at its own line', () => {
    expect(
      reflowLicenseText(
        '# Vite core license\nVite is released under the MIT license:\n\n# Bundled\n## kit, tool\nLicense: MIT',
      ),
    ).toBe('# Vite core license\nVite is released under the MIT license:\n\n# Bundled\n## kit, tool\nLicense: MIT')
  })
  it('draws a bundle heading as a heading and a ruled separator as a rule', () => {
    const html: string = renderComplianceReport(
      buildComplianceReport(
        input({
          notices: [
            {
              coordinate: 'runtime-kit@1.0.0',
              files: [{ name: 'LICENSE.md', text: '## inner-kit\nLicense: MIT\n\nMIT text\n\n-----\n\n## other' }],
            },
          ],
        }),
      ),
      attachments,
      'report',
    )
    expect(html).toContain(
      '<div class="license-entry"><p class="license-heading">inner-kit</p><p>License: MIT</p></div><p>MIT text</p>' +
        '<div class="license-entry"><hr></div>',
    )
  })
  it('groups notices that differ only in how their lines were wrapped', () => {
    const report: ComplianceReport = buildComplianceReport(
      input({
        notices: [
          { coordinate: 'runtime-kit@1.0.0', files: [{ name: 'LICENSE', text: 'Same words\nwrapped here' }] },
          { coordinate: 'shared@3.0.0', files: [{ name: 'LICENSE', text: 'Same words wrapped\nhere' }] },
        ],
      }),
    )
    expect(report.notices.map((group) => group.coordinates)).toEqual([['runtime-kit@1.0.0', 'shared@3.0.0']])
  })
})
