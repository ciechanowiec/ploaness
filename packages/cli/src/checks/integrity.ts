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
  validateImageBytes,
} from '@ploaness/governance'
import { type Context, trackedFiles } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

/** Decode every tracked image and fail on any that is corrupt or truncated. */
export const imageAssets = (context: Context): GateResult => {
  const images: readonly string[] = trackedFiles(context.root)
    .filter(isSupportedImagePath)
    .filter((file: string): boolean => existsSync(path.join(context.root, file)))
  const findings: readonly string[] = images.flatMap((file: string): readonly string[] => {
    const reason: string | null = validateImageBytes(
      file,
      readFileSync(path.join(context.root, file)),
    )
    return reason === null ? [] : [`${file}: ${reason}`]
  })
  return findings.length > 0
    ? failed(`${String(findings.length)} corrupt or truncated image asset(s)`, findings)
    : passed(`all ${String(images.length)} tracked image asset(s) decode`)
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

/**
 * Measure the total gzipped client JavaScript against the budget. Gzipped byte counts of built output are
 * a fixed function of the source and the pinned dependency versions, so the number moves only when your
 * change moves the bundle. That determinism is why this is a gate and a Lighthouse score is not.
 */
export const bundle = (context: Context): GateResult => {
  const staticDirectory: string = path.join(context.root, '.next', 'static')
  if (!existsSync(staticDirectory)) {
    return failed('the production build output is missing', [
      `${path.relative(context.root, staticDirectory)} not found; the build gate must run first`,
    ])
  }
  const files: readonly BundleFile[] = collectJavaScript(staticDirectory).map(
    (file: string): BundleFile => ({
      path: file,
      gzipBytes: gzipSync(readFileSync(file), { level: 9 }).length,
    }),
  )
  const report: BundleReport = evaluateBundle(files, context.settings.bundleBudgetBytes)
  const summary: string =
    `client JS ${asKiB(report.totalGzipBytes)} gzip across ${String(report.fileCount)} files ` +
    `(budget ${asKiB(report.budgetBytes)})`
  return report.isWithinBudget
    ? passed(summary)
    : failed(`${summary} and is over budget`, [
        'investigate the added weight, or raise ploaness.bundleBudgetBytes deliberately if justified',
      ])
}
