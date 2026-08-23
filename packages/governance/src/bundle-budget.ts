// Bundle-size budget policy: the pure logic - the byte ceiling and the sum-vs-budget evaluation - lives
// here so it is unit-tested; the CLI that walks `.next/static`, gzips each chunk, and exits is in
// scripts/check-bundle-size.ts.
//
// Why this is a DETERMINISTIC gate (unlike Lighthouse, which this repo deliberately omits): gzipped
// byte counts of built JS are a fixed function of the source + pinned dependency and Node versions, so
// the number changes only when your change changes the bundle - a true signal, never environment flake.
// It measures the TOTAL client JS (the whole `.next/static` tree), so it catches a catastrophic
// regression (an accidental heavyweight dependency) rather than a per-route First-Load delta.

/** One built client asset and its gzipped size. */
export interface BundleFile {
  readonly path: string
  readonly gzipBytes: number
}

/** The outcome of comparing the measured client JS against the budget. */
export interface BundleReport {
  readonly totalGzipBytes: number
  readonly budgetBytes: number
  readonly isWithinBudget: boolean
  readonly fileCount: number
}

// Total gzipped client-JS ceiling. Calibrated against the current production build (~768 KiB / 786,872
// bytes at gzip level 9) with headroom for the Payload admin bundle to grow as collections are added.
// This is a CONSCIOUS ceiling: raise it deliberately (in a reviewed commit) when a real feature needs
// the room, the same way the license allowlist is widened on purpose - never to silence a regression.
export const BUNDLE_BUDGET_BYTES: number = 900 * 1024

/** Sum the gzipped sizes of the built assets and compare the total against the budget. */
export const evaluateBundle = (files: readonly BundleFile[], budgetBytes: number): BundleReport => {
  const totalGzipBytes: number = files.reduce(
    (sum: number, file: BundleFile): number => sum + file.gzipBytes,
    0,
  )
  return {
    totalGzipBytes,
    budgetBytes,
    isWithinBudget: totalGzipBytes <= budgetBytes,
    fileCount: files.length,
  }
}
