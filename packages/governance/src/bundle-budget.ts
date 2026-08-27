// Bundle-size budget policy: the pure logic - the byte ceiling and the sum-vs-budget evaluation - lives
// here so it is unit-tested; the `bundle` gate in packages/cli/src/checks/integrity.ts walks
// `.next/static`, gzips each chunk, and reports.
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

// Total gzipped client-JS ceiling. This is a CONSCIOUS ceiling: raise it deliberately, in a reviewed
// commit, when a real application needs the room - the way the licence allowlist is widened on purpose,
// never to silence a regression. A project cannot raise it, only lower it, because `readSettings` takes
// `Math.min` over the declared value.
//
// It was 900 KiB, calibrated against one production build at ~768 KiB with headroom for the Payload
// admin bundle to grow. A second real Payload application measured 954.6 KiB - and roughly 680 KiB of
// that was `@payloadcms/ui`, Lexical and the datepicker Payload pulls in, before the project wrote a
// line of its own. The ceiling was therefore below what the framework this harness exists to govern
// ships on its own, which made it unreachable rather than demanding: no amount of work on the project's
// code would have brought it under.
//
// The gate is not exercised by `it/`, which builds no application, so a number here is only ever as
// good as the applications it has been checked against. It has now been checked against two.
const BYTES_PER_KIB: number = 1024
const BUDGET_KIB: number = 1100
export const BUNDLE_BUDGET_BYTES: number = BUDGET_KIB * BYTES_PER_KIB

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
