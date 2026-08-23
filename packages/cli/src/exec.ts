// Process execution for the gates, and the single result shape every gate returns. A uniform shape lets
// the runner present one verdict whether a gate shelled out to a tool or evaluated a rule in process.
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'

/** The outcome of one gate. */
export interface GateResult {
  readonly ok: boolean
  /** Lines the user must act on when the gate fails, or notable warnings when it passes. */
  readonly findings: readonly string[]
  /** One line summarising what the gate observed. */
  readonly summary: string
}

/** A passing result, optionally carrying non-failing warnings. */
export const passed = (summary: string, findings: readonly string[] = []): GateResult => ({
  ok: true,
  findings,
  summary,
})

/** A failing result carrying the findings the user must act on. */
export const failed = (summary: string, findings: readonly string[]): GateResult => ({
  ok: false,
  findings,
  summary,
})

/** Where and how to run a child process. */
export interface RunOptions {
  readonly cwd: string
  readonly env?: Readonly<Record<string, string>>
}

/** The raw outcome of a child process, with stdout and stderr interleaved. */
export interface RunResult {
  readonly code: number
  readonly output: string
}

const BYTES_PER_KIB: number = 1024
const KIB_PER_MIB: number = 1024
// Large enough that no analyzer's output is truncated before it can be reported.
const MAX_OUTPUT_MIB: number = 64
const MAX_OUTPUT_BYTES: number = MAX_OUTPUT_MIB * KIB_PER_MIB * BYTES_PER_KIB

/** Run a command, capturing stdout and stderr together. A missing binary reports code 127. */
export const run = (
  command: string,
  commandArguments: readonly string[],
  options: RunOptions,
): RunResult => {
  const result: SpawnSyncReturns<string> = spawnSync(command, [...commandArguments], {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
    env: { ...process.env, ...options.env },
  })
  if (result.error !== undefined) {
    return { code: 127, output: result.error.message }
  }
  return {
    code: result.status ?? 1,
    output: `${result.stdout}${result.stderr}`.trim(),
  }
}

/** Run a Node-based tool through the current interpreter, so no shim or PATH entry is required. */
export const runNode = (
  script: string,
  commandArguments: readonly string[],
  options: RunOptions,
): RunResult => run(process.execPath, [script, ...commandArguments], options)

/** Split a tool's combined output into findings, collapsing an empty report to a single marker line. */
export const asFindings = (output: string): readonly string[] =>
  output.length > 0 ? output.split('\n') : ['(the tool produced no output)']

/** Turn a child-process outcome into a gate result, showing the tool's own output on failure. */
export const fromRun = (result: RunResult, summary: string): GateResult =>
  result.code === 0 ? passed(summary) : failed(summary, asFindings(result.output))
