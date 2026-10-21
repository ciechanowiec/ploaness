import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, type Stats, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  asOptionalText,
  asText,
  buildComplianceReport,
  type ComplianceReport,
  classifyVulnerabilities,
  contentsPages,
  coordinateOf,
  directDependencyNames,
  type EmbeddedFont,
  HARNESS_EXCEPTIONS,
  type InventoryPackage,
  isArray,
  type NoticeFile,
  outlinePages,
  type PackageNotices,
  type ProjectManifest,
  parseLicenseInventory,
  REPORT_FILE_PREFIX,
  readKey,
  renderComplianceReport,
  reportFileStem,
} from '@ploaness/governance'
import { type AuditReading, readAdvisories } from './checks/dependencies.js'
import { runLicenseInventory } from './checks/license-inventory.js'
import { cliDirectory, git, type Repository } from './context.js'
import type { RunResult } from './exec.js'
import { ignoredOutputDirectory, publishFiles } from './output-directory.js'
import { workingTreeFingerprint } from './working-tree.js'

/** Where the report is written and which SBOM it embeds. */
export interface ComplianceReportOptions {
  readonly output: string
  readonly sbomDirectory: string
}

/** What a run of the report writer produced. */
export interface WrittenReport {
  readonly directory: string
  readonly files: readonly string[]
  /** Why no PDF was rendered, when none was. */
  readonly pdfSkipped: string | undefined
}

// A licence file larger than this is not a licence file; reading it whole would put a bundle or a data
// file into the report.
const MAX_NOTICE_BYTES: number = 262_144
const PLAYWRIGHT: string = '@playwright/test'
// A licence file is named LICENSE, LICENCE, COPYING or NOTICE, optionally with a variant such as `-MIT` or
// `-3RD-PARTY`, and optionally with a text or licence-name extension. The report leaves the project, so any
// other file that merely starts with one of those words, such as `license.key`, is never read.
const NOTICE_BASE: RegExp = /^(?:licen[cs]e|copying|notice)(?:-[a-z\d]{1,20}){0,3}$/iu
const NOTICE_EXTENSIONS: ReadonlySet<string> = new Set([
  '',
  'md',
  'markdown',
  'txt',
  'rst',
  'mit',
  'bsd',
  'isc',
  'apache',
  'apache2',
])

// A variant names a licence or a scope, never a credential: `license-key.txt` is a key, not a licence.
const CREDENTIAL_WORD: RegExp = /key|secret|token|private|password|credential|cert/iu

const isNoticeName = (name: string): boolean => {
  const dot: number = name.indexOf('.')
  const base: string = dot === -1 ? name : name.slice(0, dot)
  const extension: string = dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
  return NOTICE_BASE.test(base) && !CREDENTIAL_WORD.test(base) && NOTICE_EXTENSIONS.has(extension)
}

const readJsonFile = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'))

const sha256 = (content: string | Buffer): string => createHash('sha256').update(content).digest('hex')

const readInventory = (repository: Repository, isProductionOnly: boolean): readonly InventoryPackage[] => {
  const result: RunResult = runLicenseInventory(repository, isProductionOnly)
  const packages: readonly InventoryPackage[] | undefined =
    result.code === 0 ? parseLicenseInventory(result.stdout) : undefined
  if (packages === undefined) {
    throw new Error(`the license inventory could not be read for the compliance report: ${result.output}`)
  }
  return packages
}

/** The licence and notice files one installed package directory ships, never through a link. */
export const noticeFilesIn = (directory: string): readonly NoticeFile[] =>
  (existsSync(directory) ? readdirSync(directory) : [])
    .filter((name: string): boolean => isNoticeName(name))
    .toSorted((left: string, right: string): number => left.localeCompare(right))
    .flatMap((name: string): readonly NoticeFile[] => {
      const file: string = path.join(directory, name)
      // `lstat`, so a symbolic link is never followed: the report leaves the project, and a package that
      // ships its licence as a link could otherwise copy any file the build can read into it.
      const stat: Stats = lstatSync(file)
      return stat.isFile() && stat.size <= MAX_NOTICE_BYTES ? [{ name, text: readFileSync(file, 'utf8') }] : []
    })

// Each installed directory names its own version, which is how a notice is tied to one coordinate
// rather than to every version the inventory groups under the package name.
const noticesOf = (entry: InventoryPackage): readonly PackageNotices[] =>
  entry.paths.map((directory: string): PackageNotices => {
    const manifest: string = path.join(directory, 'package.json')
    const version: string = existsSync(manifest) ? asText(readKey(readJsonFile(manifest), 'version')) : ''
    return {
      coordinate: version.length > 0 && entry.versions.length > 0 ? coordinateOf(entry.name, version) : entry.name,
      files: noticeFilesIn(directory),
    }
  })

interface EmbeddedSbom {
  readonly text: string
  readonly sha256: string
  readonly components: number
  readonly generator: string
}

// The SBOM must describe the tree the report describes. A report built on an inventory from an earlier
// tree would print a hash that matches its download and still certify the wrong dependencies.
const readCurrentSbom = (directory: string, fingerprint: string): EmbeddedSbom => {
  const bomFile: string = path.join(directory, 'bom.cdx.json')
  const releaseFile: string = path.join(directory, 'release.json')
  if (!(existsSync(bomFile) && existsSync(releaseFile))) {
    throw new Error(`no SBOM in ${directory}; run the sbom gate or \`ploaness compliance-report\` first`)
  }
  const text: string = readFileSync(bomFile, 'utf8')
  const release: unknown = JSON.parse(readFileSync(releaseFile, 'utf8'))
  if (readKey(release, 'sourceFingerprint') !== fingerprint || readKey(release, 'sbomSha256') !== sha256(text)) {
    throw new Error(
      `the SBOM in ${directory} does not describe the current tree; run the sbom gate or ` +
        '`ploaness compliance-report` to regenerate it',
    )
  }
  const components: unknown = readKey(JSON.parse(text), 'components')
  return {
    text,
    sha256: sha256(text),
    components: isArray(components) ? components.length : 0,
    generator: asText(readKey(readKey(release, 'generator'), 'image')),
  }
}

interface FontFile {
  readonly family: string
  readonly style: 'normal' | 'italic'
  readonly weight: string
  /** Resolved from a literal specifier, so the dependency analysis sees which package each file comes from. */
  readonly url: string
}

// The typefaces the report is set in, from the OFL-licensed Fontsource packages this package depends on.
// Only the Latin subset is embedded. A character outside it falls back to the next face in the stack.
const FONT_FILES: readonly FontFile[] = [
  {
    family: 'Source Serif 4',
    style: 'normal',
    weight: '200 900',
    url: import.meta.resolve('@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2'),
  },
  {
    family: 'Source Serif 4',
    style: 'italic',
    weight: '200 900',
    url: import.meta.resolve('@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-italic.woff2'),
  },
  {
    family: 'Playfair Display',
    style: 'normal',
    weight: '400 900',
    url: import.meta.resolve('@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2'),
  },
  {
    family: 'Source Code Pro',
    style: 'normal',
    weight: '200 900',
    url: import.meta.resolve('@fontsource-variable/source-code-pro/files/source-code-pro-latin-wght-normal.woff2'),
  },
]

const embeddedFonts = (): readonly EmbeddedFont[] =>
  FONT_FILES.map(
    (font: FontFile): EmbeddedFont => ({
      family: font.family,
      style: font.style,
      weight: font.weight,
      data: readFileSync(new URL(font.url)).toString('base64'),
    }),
  )

const harnessVersion = (): string => {
  const manifest: unknown = readJsonFile(path.join(cliDirectory(), 'package.json'))
  return asText(readKey(manifest, 'version'))
}

const projectName = (repository: Repository): string => {
  const declared: string = asText(readKey(repository.packageJson, 'name'))
  return declared.length > 0 ? declared : path.basename(repository.root)
}

// An ISO timestamp up to whole seconds, `YYYY-MM-DDTHH:MM:SS`.
const SECONDS_PRECISION: number = 19

const timestamp = (): string => `${new Date().toISOString().slice(0, SECONDS_PRECISION).replace('T', ' ')} UTC`

const assemble = (repository: Repository, fingerprint: string, sbom: EmbeddedSbom): ComplianceReport => {
  const lockfile: string = path.join(repository.root, 'pnpm-lock.yaml')
  const packages: readonly InventoryPackage[] = readInventory(repository, false)
  const production: readonly InventoryPackage[] = readInventory(repository, true)
  const auditedAt: string = timestamp()
  const reading: AuditReading = readAdvisories(repository)
  if (reading.kind !== 'read') {
    throw new Error(
      [
        'complete advisory evidence is unavailable, so the report cannot state vulnerabilities',
        ...reading.findings,
      ].join('\n'),
    )
  }
  return buildComplianceReport({
    projectName: projectName(repository),
    projectDescription: asOptionalText(readKey(repository.packageJson, 'description')),
    source: {
      commit: git(repository, ['rev-parse', 'HEAD']),
      isDirty: git(repository, ['status', '--porcelain']).length > 0,
      fingerprint,
      lockfileSha256: sha256(readFileSync(lockfile)),
    },
    generatedAt: timestamp(),
    harnessVersion: harnessVersion(),
    packages,
    production,
    directNames: directDependencyNames(
      repository.projects.map((project: ProjectManifest): unknown => project.packageJson),
    ),
    vulnerabilities: classifyVulnerabilities(
      reading.advisories,
      repository.settings.vulnerabilityAllowlist,
      HARNESS_EXCEPTIONS,
    ),
    advisoryRecords: reading.advisories.length,
    auditedAt,
    sbom: { sha256: sbom.sha256, components: sbom.components, generator: sbom.generator },
    notices: packages.flatMap((entry: InventoryPackage): readonly PackageNotices[] => noticesOf(entry)),
  })
}

// The browser is the project's own Playwright, which full verification already requires for the
// end-to-end suite. A repository with no member that declares it - a library - has no browser to
// print with, and gets the HTML alone rather than a browser installed behind its back.
// Asked of the manifest before the resolver: pnpm's hidden hoist makes a package resolvable from a member
// that never declared it, and a report must not depend on which other member happened to install it.
const declaresPlaywright = (project: ProjectManifest): boolean =>
  directDependencyNames([project.packageJson]).includes(PLAYWRIGHT)

const playwrightEntry = (repository: Repository): string | undefined =>
  repository.projects
    .filter((project: ProjectManifest): boolean => declaresPlaywright(project))
    .flatMap((project: ProjectManifest): readonly string[] => {
      try {
        return [createRequire(path.join(repository.root, project.path, 'package.json')).resolve(PLAYWRIGHT)]
      } catch {
        return []
      }
    })[0]

interface PdfOptions {
  readonly format: string
  readonly printBackground: boolean
  readonly preferCSSPageSize: boolean
  readonly outline: boolean
  readonly tagged: boolean
}

interface PrintablePage {
  setContent: (html: string, options: { readonly waitUntil: 'load' }) => Promise<unknown>
  emulateMedia: (options: { readonly media: 'print' }) => Promise<unknown>
  evaluate: (expression: string) => Promise<unknown>
  pdf: (options: PdfOptions) => Promise<Uint8Array>
}

interface PrintingBrowser {
  newPage: () => Promise<PrintablePage>
  close: () => Promise<unknown>
}

interface PlaywrightModule {
  readonly chromium: { readonly launch: () => Promise<PrintingBrowser> }
}

// `@playwright/test` exports its `test` function as the module, with the browser launchers as properties
// of that function, so a lookup that accepts only plain objects never finds them.
const isObjectLike = (value: unknown): value is object =>
  value !== null && (typeof value === 'object' || typeof value === 'function')

const chromiumOf = (value: unknown): unknown =>
  isObjectLike(value) && 'chromium' in value ? value.chromium : undefined

const launchOf = (value: unknown): unknown => (isObjectLike(value) && 'launch' in value ? value.launch : undefined)

const defaultOf = (value: unknown): unknown => (isObjectLike(value) && 'default' in value ? value.default : undefined)

const isPlaywright = (candidate: unknown): candidate is PlaywrightModule =>
  typeof launchOf(chromiumOf(candidate)) === 'function'

const launchChromium = async (playwright: PlaywrightModule): Promise<PrintingBrowser> => {
  try {
    return await playwright.chromium.launch()
  } catch (error: unknown) {
    throw new Error(
      `Chromium could not be launched to print the PDF: ${String(error)}\n` +
        'install it with `pnpm exec playwright install chromium`',
      { cause: error },
    )
  }
}

const PDF_OPTIONS: PdfOptions = {
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  outline: true,
  tagged: true,
}

// Evaluated in the page. The numbers only occupy slots the contents already reserve, so writing them does
// not move a heading to another page and the second print matches the first.
const fillContentsPages = (pages: ReadonlyMap<string, number>): string =>
  `for (const [id, page] of ${JSON.stringify([...pages])}) {` +
  "const slot = document.querySelector('#toc .page[data-for=\"' + id + '\"]'); " +
  'if (slot) slot.textContent = String(page) }'

const printPdf = async (entry: string, html: string): Promise<Uint8Array> => {
  const loaded: unknown = await import(pathToFileURL(entry).href)
  const playwright: unknown = isPlaywright(loaded) ? loaded : defaultOf(loaded)
  if (!isPlaywright(playwright)) {
    throw new Error(`${entry} does not export Playwright's chromium launcher`)
  }
  const browser: PrintingBrowser = await launchChromium(playwright)
  try {
    const page: PrintablePage = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    await page.emulateMedia({ media: 'print' })
    const draft: Uint8Array = await page.pdf(PDF_OPTIONS)
    const pages: ReadonlyMap<string, number> = contentsPages(outlinePages(Buffer.from(draft).toString('latin1')))
    if (pages.size === 0) {
      return draft
    }
    await page.evaluate(fillContentsPages(pages))
    return await page.pdf(PDF_OPTIONS)
  } finally {
    await browser.close()
  }
}

// Reports from earlier commits are removed, so the directory holds exactly one report to send.
const removeEarlierReports = (directory: string, keep: readonly string[]): void => {
  const present: readonly string[] = existsSync(directory) ? readdirSync(directory) : []
  for (const name of present) {
    if (name.startsWith(REPORT_FILE_PREFIX) && /\.(?:html|pdf)$/u.test(name) && !keep.includes(name)) {
      unlinkSync(path.join(directory, name))
    }
  }
}

/**
 * Write the compliance report for the current tree: one HTML document, and its PDF rendering when
 * the project has a browser to print with.
 * @param repository the repository the report describes.
 * @param options where to write it and which SBOM to embed.
 * @returns the files written.
 */
export const writeComplianceReport = async (
  repository: Repository,
  options: ComplianceReportOptions,
): Promise<WrittenReport> => {
  const before: string = workingTreeFingerprint(repository.root)
  const sbom: EmbeddedSbom = readCurrentSbom(path.resolve(repository.root, options.sbomDirectory), before)
  const report: ComplianceReport = assemble(repository, before, sbom)
  const stem: string = reportFileStem(report.projectName, report.source.commit)
  const htmlName: string = `${stem}.html`
  const pdfName: string = `${stem}.pdf`
  const directory: string = ignoredOutputDirectory(repository, options.output, {
    files: [htmlName, pdfName, `${htmlName}.tmp`, `${pdfName}.tmp`],
    label: 'Compliance report',
  })
  const html: string = renderComplianceReport(report, { sbom: sbom.text, fonts: embeddedFonts() }, stem)
  const entry: string | undefined = playwrightEntry(repository)
  const pdf: Uint8Array | undefined = entry === undefined ? undefined : await printPdf(entry, html)
  if (before !== workingTreeFingerprint(repository.root)) {
    throw new Error('the authored tree changed while the compliance report was generated; regenerate it')
  }
  const outputs: Readonly<Record<string, string | Uint8Array>> =
    pdf === undefined ? { [htmlName]: html } : { [htmlName]: html, [pdfName]: pdf }
  const written: readonly string[] = Object.keys(outputs)
  removeEarlierReports(directory, written)
  publishFiles(directory, outputs)
  return {
    directory,
    files: written.map((file: string): string => path.join(directory, file)),
    pdfSkipped:
      pdf === undefined ? 'no workspace package declares @playwright/test, so no browser can print it' : undefined,
  }
}
