// Process execution for the gates, and the single result shape every gate returns. A uniform shape lets
// the runner present one verdict whether a gate shelled out to a tool or evaluated a rule in process.
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import path from 'node:path'
// Owned by `governance` because the docker-failure classifier decides on it too, and a number two
// modules must agree about will not stay agreed about while each states it.
import { COMMAND_NOT_FOUND } from '@ploaness/governance'

/** The outcome of one gate. */
export interface GateResult {
  readonly ok: boolean
  /** Lines the user must act on when the gate fails, or an informational report when it passes. */
  readonly findings: readonly string[]
  /** One line summarising what the gate observed. */
  readonly summary: string
  /**
   * What the underlying tool actually printed, kept whole and printed only on request.
   *
   * Deliberately apart from `findings`, whose contract is the lines a user must ACT on: a passing
   * gate's output is not that, and merging the two would make a gate that found nothing read as
   * though it had. Held so a reader can audit a verdict rather than take it on faith - "no
   * vulnerability at or above moderate" is a claim, and this is the evidence for it.
   */
  readonly output?: string
}

/** A passing result, optionally carrying a non-failing report. */
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

/** The same result, carrying the tool output that produced it. */
export const withOutput = (result: GateResult, output: string): GateResult =>
  output.length > 0 ? { ...result, output } : result

/** Where and how to run a child process. */
export interface RunOptions {
  readonly cwd: string
  readonly env?: Readonly<Record<string, string>>
  /** Text to write to the child's stdin, for a tool that reads its subject there. */
  readonly input?: string
  /**
   * Kill the tool after this many milliseconds, reporting `TIMED_OUT_CODE`.
   *
   * Omitted means the tool decides when it is done, which is right for an analyzer reading the tree and
   * wrong for anything that opens a socket. A hung request produced no output and no verdict, so on a
   * team's CI a stuck gate was indistinguishable from a stuck build - and unlike a gate failure, nothing
   * said which it was, because nothing ended.
   */
  readonly timeoutMs?: number
}

/** The raw outcome of a child process. */
export interface RunResult {
  readonly code: number
  /** Both streams together, which is what a finding shows the user. */
  readonly output: string
  /**
   * Standard output alone.
   *
   * A caller that PARSES the output must read this. `output` concatenates the two streams with no
   * separator, and pnpm writes ` WARN ` lines to stderr as a matter of course - an unsupported engine,
   * an ignored build script, a peer conflict. Feeding that to `JSON.parse` made the licence and
   * advisory gates fail closed while blaming the registry for a warning the tool had merely mentioned.
   */
  readonly stdout: string
}

const BYTES_PER_KIB: number = 1024
const KIB_PER_MIB: number = 1024
// Large enough that no analyzer's output is truncated before it can be reported.
const MAX_OUTPUT_MIB: number = 64
const MAX_OUTPUT_BYTES: number = MAX_OUTPUT_MIB * KIB_PER_MIB * BYTES_PER_KIB

// A tool that could not start and a tool that produced more output than the buffer holds are different
// problems, and reporting both as 127 made the second read as "Docker is not available". The buffer
// case is named for what it is.
// The third case is a tool killed for exceeding its deadline. It is not a tool that is missing, and
// saying "not installed" about a registry that merely hung sends a team looking for the wrong thing.
//
// Matched on the message because node writes it - `spawnSync <cmd> ETIMEDOUT` - so no output a tool
// produced can reach this decision, which is the same guarantee the `maxBuffer` line already relies on.
const OUT_OF_BUFFER: string = 'ENOBUFS'
const TIMED_OUT: string = 'ETIMEDOUT'

/** The exit status reported for a tool killed for exceeding the deadline its caller set. */
export const TIMED_OUT_CODE: number = 124

const startupFailure = (error: Error): RunResult => {
  if (error.message.includes('maxBuffer')) {
    return {
      code: 1,
      output: `${OUT_OF_BUFFER}: the tool produced more than ${String(MAX_OUTPUT_MIB)} MiB of output`,
      stdout: '',
    }
  }
  return error.message.includes(TIMED_OUT)
    ? { code: TIMED_OUT_CODE, output: `${TIMED_OUT}: ${error.message}`, stdout: '' }
    : { code: COMMAND_NOT_FOUND, output: error.message, stdout: '' }
}

export { COMMAND_NOT_FOUND } from '@ploaness/governance'

// A process killed by a signal reports no status at all, and reporting it as an ordinary failure hid
// the one fact that explains it - an out-of-memory kill during a build looks exactly like a build that
// found an error.
const describeSignal = (signal: NodeJS.Signals | null): readonly string[] =>
  signal === null ? [] : [`the process was killed by ${signal}`]

/** Run a command, capturing stdout and stderr both together and apart. */
// `runNode` invokes a tool through the interpreter so ploaness needs no shim of its own, but a tool it
// starts can start further processes, and those resolve through PATH like anything else. Playwright's
// `webServer` runs `next dev` through `/bin/sh`, which found nothing: the project's `node_modules/.bin`
// was on PATH only for a project whose `testWrapper` happened to route the run through a package
// manager, because that is what puts it there. The e2e gate therefore passed or failed on whether the
// project had declared an unrelated setting. Prepending it here makes the child's PATH the same either
// way, and prepending rather than appending keeps the project's own copy of a tool ahead of any
// same-named one already on PATH.
const withProjectBinaries = (
  cwd: string,
  overrides: Readonly<Record<string, string>> | undefined,
): Record<string, string | undefined> => {
  const binaries: string = path.join(cwd, 'node_modules', '.bin')
  const inherited: string | undefined = process.env['PATH']
  return {
    ...process.env,
    ...overrides,
    PATH: inherited === undefined ? binaries : `${binaries}${path.delimiter}${inherited}`,
  }
}

export const run = (
  command: string,
  commandArguments: readonly string[],
  options: RunOptions,
): RunResult => {
  const result: SpawnSyncReturns<string> = spawnSync(command, [...commandArguments], {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
    env: withProjectBinaries(options.cwd, options.env),
    ...(options.input !== undefined && { input: options.input }),
    ...(options.timeoutMs !== undefined && { timeout: options.timeoutMs }),
  })
  if (result.error !== undefined) {
    return startupFailure(result.error)
  }
  return {
    code: result.status ?? 1,
    output: [`${result.stdout}${result.stderr}`.trim(), ...describeSignal(result.signal)]
      .filter((part: string): boolean => part.length > 0)
      .join('\n'),
    stdout: result.stdout,
  }
}

/** Run a Node-based tool through the current interpreter, so no shim or PATH entry is required. */
export const runNode = (
  script: string,
  commandArguments: readonly string[],
  options: RunOptions,
): RunResult => run(process.execPath, [script, ...commandArguments], options)

/**
 * Split a tool's combined output into findings, collapsing an empty report to a single marker line.
 * @param output the tool's own text.
 * @returns one entry per line, with CRLF endings normalised so no finding carries a stray `\r`.
 */
export const asFindings = (output: string): readonly string[] =>
  output.length > 0
    ? output.replaceAll('\r\n', '\n').split('\n')
    : ['(the tool produced no output)']

/**
 * Turn a child-process outcome into a gate result.
 *
 * Two summaries, not one. Every call site phrases its summary as an assertion that the check passed -
 * "module architecture holds", "no dead code or unused dependency" - and the report prints the summary
 * for whichever verdict it got. So a failing run announced itself as `x knip  no dead code or unused
 * dependency`, which is the gate contradicting itself on the line the reader looks at first.
 * @param result the child-process outcome.
 * @param passSummary what is true when the tool exits zero.
 * @param failSummary what to say when it does not.
 * @returns the gate result, carrying the tool's own output on failure.
 */
export const fromRun = (result: RunResult, passSummary: string, failSummary: string): GateResult =>
  withOutput(
    result.code === 0 ? passed(passSummary) : failed(failSummary, asFindings(result.output)),
    result.output,
  )
