// Asset integrity: an image that will not render, and a client bundle that has quietly doubled. Both are
// defects a status check and an accessibility sweep miss, because the response is a valid 200 and the
// markup is correct.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  type BundleFile,
  type BundleReport,
  evaluateBundle,
  isSupportedImagePath,
  parseProductionDirectory,
  validateImageBytes,
} from '@ploaness/governance'
import { type Context, cliDirectory, hasOwnRuntime, workingTreeFiles } from '../context.js'
import { asFindings, failed, type GateResult, passed, type RunResult, run } from '../exec.js'
import { type Invocation, withPretest, wrapped } from '../test-invocation.js'

/** Decode every image in the working tree and fail on any that is corrupt or truncated. */
export const imageAssets = (context: Context): GateResult => {
  const images: readonly string[] = workingTreeFiles(context.root)
    .filter(isSupportedImagePath)
    .filter((file: string): boolean => existsSync(path.join(context.root, file)))
  const findings: readonly string[] = images.flatMap((file: string): readonly string[] => {
    const reason: string | null = validateImageBytes(file, readFileSync(path.join(context.root, file)))
    return reason === null ? [] : [`${file}: ${reason}`]
  })
  return findings.length > 0
    ? failed(`${String(findings.length)} corrupt or truncated image asset(s)`, findings)
    : passed(`all ${String(images.length)} image asset(s) decode`)
}

const collectJavaScript = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry): readonly string[] => {
    const full: string = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return collectJavaScript(full)
    }
    return entry.name.endsWith('.js') ? [full] : []
  })

const BYTES_PER_KIB: number = 1024
const KIB_DECIMALS: number = 1
const asKiB = (bytes: number): string => `${(bytes / BYTES_PER_KIB).toFixed(KIB_DECIMALS)} KiB`

const measureBundle = (staticDirectory: string, budget: number): GateResult => {
  if (!existsSync(staticDirectory)) {
    return failed('the production build output is missing', [
      `${staticDirectory} not found; the build gate must run first`,
    ])
  }
  const files: readonly BundleFile[] = collectJavaScript(staticDirectory).map(
    (file: string): BundleFile => ({
      path: file,
      gzipBytes: gzipSync(readFileSync(file), { level: 9 }).length,
    }),
  )
  const report: BundleReport = evaluateBundle(files, budget)
  const summary: string =
    `client JS ${asKiB(report.totalGzipBytes)} gzip across ${String(report.fileCount)} files ` +
    `(budget ${asKiB(report.budgetBytes)})`
  return report.isWithinBudget
    ? passed(summary)
    : failed(`${summary} and is over budget`, [
        // Not "raise the setting": `readSettings` clamps it with `Math.min`, so a project can only
        // ever lower it. Advising an action the code forbids is the defect this message used to be.
        "investigate the added weight; the ceiling is the harness's, and a project may only lower it",
      ])
}

const PRODUCTION_PROBE_TIMEOUT_MS: number = 120_000

const inspectBundle = (context: Context): GateResult => {
  const invocation: Invocation = wrapped(context, [
    path.join(cliDirectory(), 'dist/probes/production-directory.probe.js'),
  ])
  const result: RunResult = run(invocation.command, invocation.commandArguments, {
    cwd: context.root,
    // Next must load its production files itself, before generic .env values can become process overrides.
    env: { NODE_ENV: 'production', NODE_OPTIONS: '--no-deprecation', NEXT_TELEMETRY_DISABLED: '1' },
    timeoutMs: PRODUCTION_PROBE_TIMEOUT_MS,
  })
  if (result.code !== 0) {
    return failed('the Next production output could not be located', asFindings(result.output))
  }
  const directory: string | undefined = parseProductionDirectory(result.stdout)
  if (directory === undefined || !path.isAbsolute(directory)) {
    return failed('the production-directory probe printed incomplete or malformed evidence', asFindings(result.output))
  }
  return measureBundle(path.join(directory, 'static'), context.settings.bundleBudgetBytes)
}

/** Measure gzipped client JavaScript from the configured production artifact. */
export const bundle = (context: Context): GateResult => {
  // A library's manifest declares no runtime, so no application build output is expected.
  if (!hasOwnRuntime(context)) {
    return passed('this package has no runtime of its own, so it ships no client bundle')
  }
  return withPretest(context, (): GateResult => inspectBundle(context))
}
