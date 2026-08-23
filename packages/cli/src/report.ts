// Run-log presentation. A verification prints one line per gate as it completes, then the findings of
// every gate that failed, so a long run is readable while it happens and actionable when it ends.

import type { GateResult } from './exec.js'
import type { Gate } from './gates.js'

const PASS: string = 'PASS'
const FAIL: string = 'FAIL'
const WARN: string = 'WARN'

/** One completed gate and what it found. */
export interface GateOutcome {
  readonly gate: Gate
  readonly result: GateResult
}

const label = (result: GateResult): string => {
  if (!result.ok) {
    return FAIL
  }
  return result.findings.length > 0 ? WARN : PASS
}

/** Print the one-line verdict for a gate that has just finished. */
export const reportGate = (outcome: GateOutcome): void => {
  const line: string = `[${label(outcome.result)}] ${outcome.gate.id.padEnd(20)} ${outcome.result.summary}`
  if (outcome.result.ok) {
    console.info(line)
  } else {
    console.error(line)
  }
}

/** Print the findings of every gate that failed, plus any warnings a passing gate raised. */
export const reportFindings = (outcomes: readonly GateOutcome[]): void => {
  for (const outcome of outcomes) {
    if (outcome.result.ok && outcome.result.findings.length === 0) {
      continue
    }
    const heading: string = `${label(outcome.result)} ${outcome.gate.id}: ${outcome.gate.title}`
    console.error(`\n${heading}\n${'-'.repeat(heading.length)}`)
    for (const finding of outcome.result.findings) {
      console.error(`  ${finding}`)
    }
  }
}

/** Print the closing verdict and return the process exit code. */
export const reportVerdict = (
  outcomes: readonly GateOutcome[],
  extended: boolean,
  enforce: boolean,
): number => {
  const failures: readonly GateOutcome[] = outcomes.filter(
    (outcome: GateOutcome): boolean => !outcome.result.ok,
  )
  const mode: string = extended ? 'Extended verification' : 'Default verification'
  if (failures.length === 0) {
    console.info(`\n${mode} passed: ${outcomes.length} gate(s) green.`)
    return 0
  }
  const names: string = failures.map((outcome: GateOutcome): string => outcome.gate.id).join(', ')
  console.error(`\n${mode} failed: ${failures.length} of ${outcomes.length} gate(s) (${names}).`)
  if (!enforce) {
    console.error('Report-only mode is active, so the exit code is 0. This is not a pass.')
    return 0
  }
  return 1
}
