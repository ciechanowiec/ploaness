// The passes of the managed browser sweep. The pinned spec calls one of these per test, so each part of
// a pass has its own budget and one failing part hides nothing another would have reported.
//
// Discovery runs once, in Chromium, as the setup project every pass depends on, and writes what it
// found - routes, stories, breakpoints, colour schemes, control counts - to the ignored output
// directory. Every pass is split into shards that run as separate tests on parallel workers; each
// reads that file instead of crawling again, and writes its own findings and coverage under its
// engine's directory. The summary is the teardown: it runs after every part of every engine has
// finished, whatever their outcome, judges discovery's problems and the exemptions no part used, and
// prints the coverage. A part that did not finish is reported there too, so reduced coverage never
// reads as a full pass.
//
// Nothing here decides what a defect is. Each verdict is a `@ploaness/governance` function over what the
// browser measured; the `sweep-*` modules drive the browser into each state and hand over the
// measurements. This module is the entry point: it holds the summary and re-exports every pass.
import { readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type TestInfo, test } from '@playwright/test'
import {
  BROWSER_ENGINES,
  type BrowserFinding,
  coversEveryEngine,
  type DeclaredExemption,
  distinctFindings,
  findingLine,
  type Shard,
  type SweepPass,
  staleExemptions,
  type TemplateSample,
  type UsedExemption,
} from '@ploaness/governance'
import {
  type Discovery,
  type DiscoveryReport,
  discoveryFile,
  discoveryReportFile,
  isDiscovery,
  isDiscoveryReport,
  isPassReport,
  type PassReport,
  readJson,
  reportFile,
  reportName,
  sweepRoot,
  writeJson,
} from './sweep-shared.js'
import { SWEEP_WORKERS as SWEEP_SHARDS } from './sweep-workers.js'

export { expectDisclosureStates } from './sweep-disclosures.js'
export { expectDiscoveredSite } from './sweep-discovery.js'
export { expectInteractionStates } from './sweep-interaction.js'
export { expectTextStress, expectWidthSweep } from './sweep-reflow.js'
export { expectDarkScheme, expectEngineRules, expectRestingRules } from './sweep-resting.js'
export type { Shard } from './sweep-shared.js'
export { SWEEP_WORKERS as SWEEP_SHARDS } from './sweep-workers.js'

const CHROMIUM: string = 'chromium'

const CHROMIUM_PASSES: readonly SweepPass[] = [
  'resting',
  'interaction',
  'disclosures',
  'text-stress',
  'width-sweep',
  'dark-scheme',
]

const ENGINE_PASSES: readonly SweepPass[] = ['engine']

const SHARDS: readonly Shard[] = Array.from(
  { length: SWEEP_SHARDS },
  (_unused: unknown, index: number): Shard => ({
    index,
    count: SWEEP_SHARDS,
  }),
)

/** One part of a pass the summary expects a report from. */
interface ExpectedReport {
  readonly engine: string
  readonly pass: SweepPass
  readonly shard: Shard
}

const presentEngines = (info: TestInfo): readonly string[] => {
  try {
    return readdirSync(sweepRoot(info), { withFileTypes: true }).flatMap((entry): readonly string[] =>
      entry.isDirectory() && BROWSER_ENGINES.includes(entry.name) ? [entry.name] : [],
    )
  } catch {
    return []
  }
}

// Chromium always runs; the other engines run when the pinned browsers do outside a `delta` run's
// change scope, and whatever ran in them is judged even when the endpoint is no longer named.
const expectedEngines = (info: TestInfo): readonly string[] => {
  const isEveryEngine: boolean = coversEveryEngine(process.env)
  const present: ReadonlySet<string> = new Set<string>(presentEngines(info))
  return BROWSER_ENGINES.filter(
    (engine: string): boolean => engine === CHROMIUM || isEveryEngine || present.has(engine),
  )
}

const expectedReports = (engines: readonly string[]): readonly ExpectedReport[] =>
  engines.flatMap((engine: string): readonly ExpectedReport[] =>
    (engine === CHROMIUM ? CHROMIUM_PASSES : ENGINE_PASSES).flatMap((pass: SweepPass): readonly ExpectedReport[] =>
      SHARDS.map((shard: Shard): ExpectedReport => ({ engine, pass, shard })),
    ),
  )

const missingLine = (expected: ExpectedReport): string =>
  `${expected.engine} ${expected.pass} part ${String(expected.shard.index + 1)} of ${String(expected.shard.count)}: ` +
  `did not record ${reportName(expected.pass, expected.shard)}`

const MS_PER_SECOND: number = 1000

const NOTHING_DISCOVERED: Discovery = { routes: [], stories: [], locations: [], samples: [] }

const NO_DISCOVERY_REPORT: DiscoveryReport = {
  findings: [],
  problems: [],
  places: 0,
  locations: [],
  elapsedMs: 0,
  scope: { isScoped: false, lines: [] },
}

const discoveryText = (discovery: Discovery, report: DiscoveryReport): string =>
  `discovery (${CHROMIUM}): ${String(discovery.routes.length)} routes, ${String(discovery.stories.length)} stories, ` +
  `${String(discovery.samples.length)} templates, ${String(report.findings.length)} findings, ` +
  `${String(Math.round(report.elapsedMs / MS_PER_SECOND))}s`

// One line per pass in each engine: the places and findings of its parts summed, the locations they
// covered, and the slowest part, which is how long the pass held the run. A pass a change scope narrowed
// says so, because its coverage is not complete.
const passLine = (engine: string, pass: SweepPass, reports: readonly PassReport[], isScoped: boolean): string => {
  const parts: readonly PassReport[] = reports.filter(
    (report: PassReport): boolean => report.engine === engine && report.pass === pass,
  )
  const places: number = parts.reduce((total: number, report: PassReport): number => total + report.places, 0)
  const findings: number = parts.reduce(
    (total: number, report: PassReport): number => total + report.findings.length,
    0,
  )
  const locations: number = new Set<string>(parts.flatMap((report: PassReport): readonly string[] => report.locations))
    .size
  const slowestMs: number = Math.max(0, ...parts.map((report: PassReport): number => report.elapsedMs))
  return (
    `${pass} (${engine}${isScoped ? ', scoped to the change' : ''}): ${String(places)} places over ` +
    `${String(locations)} locations, ${String(findings)} ` +
    `findings, ${String(parts.length)} of ${String(SWEEP_SHARDS)} parts, slowest part ` +
    `${String(Math.round(slowestMs / MS_PER_SECOND))}s`
  )
}

/** Everything the summary read. */
interface SweepRecord {
  readonly discovery: Discovery | undefined
  readonly discoveryReport: DiscoveryReport | undefined
  readonly engines: readonly string[]
  readonly reports: readonly PassReport[]
  readonly missing: readonly string[]
}

const coverageText = (record: SweepRecord): string =>
  [
    ...(record.discoveryReport ?? NO_DISCOVERY_REPORT).scope.lines.map((line: string): string => `scope: ${line}`),
    discoveryText(record.discovery ?? NOTHING_DISCOVERED, record.discoveryReport ?? NO_DISCOVERY_REPORT),
    ...(record.discovery?.samples ?? []).map(
      (sample: TemplateSample): string =>
        `  template ${sample.template}: sampled by ${sample.route} (${String(sample.routes)} routes)`,
    ),
    ...record.engines.flatMap((engine: string): readonly string[] =>
      (engine === CHROMIUM ? CHROMIUM_PASSES : ENGINE_PASSES).map((pass: SweepPass): string =>
        passLine(engine, pass, record.reports, record.discoveryReport?.scope.isScoped ?? false),
      ),
    ),
    ...[...new Set<string>(record.reports.flatMap((report: PassReport): readonly string[] => report.notes))].map(
      (note: string): string => `  note: ${note}`,
    ),
    ...record.missing,
  ].join('\n')

// An exemption is stale in an engine when no part of any pass in that engine used it.
const staleIn = (engine: string, reports: readonly PassReport[]): readonly BrowserFinding[] => {
  const own: readonly PassReport[] = reports.filter((report: PassReport): boolean => report.engine === engine)
  return own.length === 0
    ? []
    : staleExemptions(
        own.flatMap((report: PassReport): readonly DeclaredExemption[] => report.declared),
        own.flatMap((report: PassReport): readonly UsedExemption[] => report.used),
        [...new Set<string>(own.flatMap((report: PassReport): readonly string[] => report.judgedRules))],
        engine,
      )
}

const readRecord = (info: TestInfo): SweepRecord => {
  const engines: readonly string[] = expectedEngines(info)
  const expected: readonly ExpectedReport[] = expectedReports(engines)
  const read: readonly (PassReport | undefined)[] = expected.map((part: ExpectedReport): PassReport | undefined =>
    readJson(reportFile(info, part.engine, part.pass, part.shard), isPassReport),
  )
  return {
    discovery: readJson(discoveryFile(info), isDiscovery),
    discoveryReport: readJson(discoveryReportFile(info), isDiscoveryReport),
    engines,
    reports: read.flatMap((report: PassReport | undefined): readonly PassReport[] =>
      report === undefined ? [] : [report],
    ),
    missing: expected.flatMap((part: ExpectedReport, index: number): readonly string[] =>
      read[index] === undefined ? [missingLine(part)] : [],
    ),
  }
}

/**
 * Judge discovery's problems and findings and the exemptions no part of a pass used, write the report
 * and the coverage summary, and fail when a part of a pass did not finish. It runs as the sweep's
 * teardown, after every part of every engine, whatever their outcome.
 */
export const expectSweepSummary = async (): Promise<void> => {
  const info: TestInfo = test.info()
  const record: SweepRecord = readRecord(info)
  const problems: readonly string[] =
    record.discovery === undefined || record.discoveryReport === undefined
      ? ['discovery did not record what to scan; its own test names the reason']
      : record.discoveryReport.problems
  const discoveryFindings: readonly BrowserFinding[] = distinctFindings(record.discoveryReport?.findings ?? [])
  const stale: readonly BrowserFinding[] = record.engines.flatMap((engine: string): readonly BrowserFinding[] =>
    staleIn(engine, record.reports),
  )
  const coverage: string = coverageText(record)
  writeJson(path.join(sweepRoot(info), 'report.json'), {
    findings: distinctFindings([
      ...discoveryFindings,
      ...record.reports.flatMap((report: PassReport): readonly BrowserFinding[] => report.findings),
      ...stale,
    ]),
    problems,
    scope: record.discoveryReport?.scope,
    passes: record.reports.map((report: PassReport) => ({
      pass: report.pass,
      engine: report.engine,
      shard: report.shard,
      places: report.places,
      locations: report.locations,
      notes: report.notes,
      elapsedMs: report.elapsedMs,
    })),
    missing: record.missing,
  })
  writeFileSync(path.join(sweepRoot(info), 'coverage.txt'), `${coverage}\n`)
  await info.attach('coverage', { body: coverage, contentType: 'text/plain' })
  process.stdout.write(`\nploaness sweep coverage:\n${coverage}\n`)
  expect.soft(problems, 'discovery is incomplete').toEqual([])
  expect
    .soft(
      discoveryFindings.map((finding: BrowserFinding): string => findingLine(finding)),
      'discovery findings',
    )
    .toEqual([])
  expect.soft(record.missing, 'sweep parts that did not finish; their own tests name the reason').toEqual([])
  expect(
    stale.map((finding: BrowserFinding): string => findingLine(finding)),
    'exemptions no pass used',
  ).toEqual([])
}
