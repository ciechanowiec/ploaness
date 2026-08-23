import { describe, expect, it } from 'vitest'
import {
  BUNDLE_BUDGET_BYTES,
  type BundleFile,
  type BundleReport,
  evaluateBundle,
} from '../src/bundle-budget.js'

const files = (...sizes: number[]): BundleFile[] =>
  sizes.map((gzipBytes: number): BundleFile => ({ path: 'chunk.js', gzipBytes }))

describe('evaluateBundle', () => {
  it('sums the gzipped sizes and counts the files', () => {
    const report: BundleReport = evaluateBundle(files(100, 250, 50), 1000)
    expect(report.totalGzipBytes).toBe(400)
    expect(report.fileCount).toBe(3)
  })

  it('is within budget when the total is at or below the ceiling', () => {
    expect(evaluateBundle(files(600, 400), 1000).isWithinBudget).toBe(true)
  })

  it('is over budget when the total exceeds the ceiling by a single byte', () => {
    expect(evaluateBundle(files(1001), 1000).isWithinBudget).toBe(false)
  })

  it('treats an empty build as zero bytes within any budget', () => {
    const report: BundleReport = evaluateBundle([], 1000)
    expect(report.totalGzipBytes).toBe(0)
    expect(report.fileCount).toBe(0)
    expect(report.isWithinBudget).toBe(true)
  })

  it('echoes back the budget it was given', () => {
    expect(evaluateBundle(files(1), 42).budgetBytes).toBe(42)
  })
})

describe('BUNDLE_BUDGET_BYTES', () => {
  it('is a positive byte ceiling with headroom above the current build', () => {
    // Current production build measures ~786,872 bytes gzip; the budget must sit above it.
    expect(BUNDLE_BUDGET_BYTES).toBeGreaterThan(786_872)
  })
})
