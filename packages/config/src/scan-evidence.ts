// Completed project scans share the current run's output directory. Discovery clears it before its
// dependent project tests start; the teardown reads it after those tests finish.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { type TestInfo, test } from '@playwright/test'
import { isRecord } from '@ploaness/governance'

const DIRECTORY: string = 'ploaness-project-scans'

const directoryOf = (info: TestInfo): string => path.join(info.project.outputDir, DIRECTORY)

/** Clear evidence from earlier runs before any dependent project specification starts. */
export const clearCompletedScans = (): void => {
  rmSync(directoryOf(test.info()), { recursive: true, force: true })
}

/**
 * Record a successful combined scan, after every required viewport has been judged.
 * @param url the unchanged URL whose complete page was scanned.
 */
export const recordCompletedScan = (url: string): void => {
  const info: TestInfo = test.info()
  const directory: string = directoryOf(info)
  const name: string = createHash('sha256').update(`${info.testId}\n${url}`).digest('hex')
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, `${name}.json`), JSON.stringify({ url, testId: info.testId }))
}

/**
 * Read the routes successfully scanned on this application's origin. Stories and auxiliary servers
 * cannot supply evidence for a similarly named application route. A damaged record fails the summary.
 * @param origin the application origin.
 * @returns the routes reached by completed combined scans.
 */
export const completedScanRoutes = (origin: string): readonly string[] => {
  const directory: string = directoryOf(test.info())
  if (!existsSync(directory)) {
    return []
  }
  return readdirSync(directory).flatMap((name: string): readonly string[] => {
    const value: unknown = JSON.parse(readFileSync(path.join(directory, name), 'utf8'))
    if (!isRecord(value) || typeof value['url'] !== 'string' || typeof value['testId'] !== 'string') {
      throw new Error(`Invalid completed scan record: ${name}`)
    }
    const url: URL = new URL(value['url'])
    return url.origin === origin ? [url.pathname] : []
  })
}
