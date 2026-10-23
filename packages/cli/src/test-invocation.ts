// Preparation and wrapper invocation shared by tests, builds, and production-output inspection.
import type { Context } from './context.js'
import { asFindings, failed, type GateResult, type RunResult, run } from './exec.js'
import { clockedEnvironment } from './pinned-browsers.js'

// A Payload suite needs a database before it can boot, and how the project obtains one is a fact ploaness
// cannot know. The project declares it; the thresholds and the gate itself stay ploaness's.
const runPretest = (context: Context): RunResult | undefined => {
  const [command, ...rest] = context.settings.pretest
  return command === undefined
    ? undefined
    : run(command, rest, { cwd: context.root, env: clockedEnvironment(context, '--no-deprecation') })
}

/** The executable command after applying the project wrapper. */
export interface Invocation {
  readonly command: string
  readonly commandArguments: readonly string[]
}

/** Route Node execution through the same declared wrapper used by builds and tests. */
export const wrapped = (context: Context, interpreterArguments: readonly string[]): Invocation => {
  const [wrapper, ...wrapperRest] = context.settings.testWrapper
  if (wrapper === undefined) {
    return { command: process.execPath, commandArguments: interpreterArguments }
  }
  return {
    command: wrapper,
    commandArguments: [...wrapperRest, process.execPath, ...interpreterArguments],
  }
}

/** Prepare project services before an operation that loads or runs application code. */
export const withPretest = <Outcome extends GateResult | Promise<GateResult>>(
  context: Context,
  gate: () => Outcome,
): GateResult | Outcome => {
  const pretest: RunResult | undefined = runPretest(context)
  return pretest === undefined || pretest.code === 0
    ? gate()
    : failed('the declared pretest command failed', asFindings(pretest.output))
}
