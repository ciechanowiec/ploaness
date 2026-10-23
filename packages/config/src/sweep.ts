// The passes of the managed browser sweep. The pinned spec calls one of these per test, so each pass has
// its own budget and one failing pass hides nothing another would have reported.
//
// Discovery runs first and writes what it found - routes, stories, breakpoints, colour schemes, control
// counts - to the ignored output directory. Every later pass reads that file instead of crawling again,
// and writes its own findings and coverage beside it. The last test reads them all, judges the
// exemptions no pass used, and prints the coverage summary. A pass that did not finish is reported there
// too, so reduced coverage never reads as a full pass.
//
// Nothing here decides what a defect is. Each verdict is a `@ploaness/governance` function over what the
// browser measured; the `sweep-*` modules drive the browser into each state and hand over the
// measurements. This module is the entry point: it holds the summary and re-exports every pass.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page, type TestInfo, test } from '@playwright/test'
import {
  type BrowserFinding,
  type DeclaredExemption,
  distinctFindings,
  findingLine,
  type SweepPass,
  staleExemptions,
  type TemplateSample,
  type UsedExemption,
} from '@ploaness/governance'
import { engineOf } from './scanner.js'
import {
  type Discovery,
  discoveryFile,
  isChromium,
  type PassReport,
  readJson,
  reportFile,
  sweepDirectory,
  writeJson,
} from './sweep-shared.js'

export { expectDisclosureStates } from './sweep-disclosures.js'
export { expectDiscoveredSite } from './sweep-discovery.js'
export { expectInteractionStates } from './sweep-interaction.js'
export { expectTextStress, expectWidthSweep } from './sweep-reflow.js'
export { expectDarkScheme, expectEngineRules, expectRestingRules } from './sweep-resting.js'

const CHROMIUM_PASSES: readonly SweepPass[] = [
  'discovery',
  'resting',
  'interaction',
  'disclosures',
  'text-stress',
  'width-sweep',
  'dark-scheme',
]

const ENGINE_PASSES: readonly SweepPass[] = ['discovery', 'engine']

const discoveryText = (discovery: Discovery | undefined): string =>
  `discovered ${String(discovery?.routes.length ?? 0)} routes, ${String(discovery?.stories.length ?? 0)} stories, ` +
  `${String(discovery?.samples.length ?? 0)} templates`

const coverageText = (
  discovery: Discovery | undefined,
  reports: readonly PassReport[],
  missing: readonly SweepPass[],
): string =>
  [
    discoveryText(discovery),
    ...(discovery?.samples ?? []).map(
      (sample: TemplateSample): string =>
        `  template ${sample.template}: sampled by ${sample.route} (${String(sample.routes)} routes)`,
    ),
    ...reports.map(
      (report: PassReport): string =>
        `${report.pass} (${report.engine}): ${String(report.places)} places over ${String(report.locations.length)} ` +
        `locations, ${String(report.findings.length)} findings`,
    ),
    ...reports.flatMap((report: PassReport): readonly string[] =>
      report.notes.map((note: string): string => `  note: ${note}`),
    ),
    ...missing.map((pass: SweepPass): string => `${pass}: did not record a report`),
  ].join('\n')

/**
 * Judge the exemptions no pass used, write the report and the coverage summary, and fail when a pass
 * did not finish.
 * @param page the test's page.
 */
export const expectSweepSummary = async (page: Page): Promise<void> => {
  const info: TestInfo = test.info()
  const expected: readonly SweepPass[] = isChromium(page) ? CHROMIUM_PASSES : ENGINE_PASSES
  const reports: readonly PassReport[] = expected.flatMap((pass: SweepPass): readonly PassReport[] => {
    const report: PassReport | undefined = readJson(reportFile(info, pass)) as PassReport | undefined
    return report === undefined ? [] : [report]
  })
  const missing: readonly SweepPass[] = expected.filter(
    (pass: SweepPass): boolean => !reports.some((report: PassReport): boolean => report.pass === pass),
  )
  const stale: readonly BrowserFinding[] = staleExemptions(
    reports.flatMap((report: PassReport): readonly DeclaredExemption[] => report.declared),
    reports.flatMap((report: PassReport): readonly UsedExemption[] => report.used),
    [...new Set<string>(reports.flatMap((report: PassReport): readonly string[] => report.judgedRules))],
    engineOf(page),
  )
  const coverage: string = coverageText(readJson(discoveryFile(info)) as Discovery | undefined, reports, missing)
  writeJson(path.join(sweepDirectory(info), 'report.json'), {
    findings: distinctFindings([
      ...reports.flatMap((report: PassReport): readonly BrowserFinding[] => report.findings),
      ...stale,
    ]),
    passes: reports.map((report: PassReport) => ({
      pass: report.pass,
      places: report.places,
      locations: report.locations,
      notes: report.notes,
    })),
    missing,
  })
  writeFileSync(path.join(sweepDirectory(info), 'coverage.txt'), `${coverage}\n`)
  await info.attach('coverage', { body: coverage, contentType: 'text/plain' })
  process.stdout.write(`\nploaness sweep coverage (${info.project.name}):\n${coverage}\n`)
  expect.soft(missing, 'sweep passes that did not finish; their own tests name the reason').toEqual([])
  expect(
    stale.map((finding: BrowserFinding): string => findingLine(finding)),
    'exemptions no pass used',
  ).toEqual([])
}
