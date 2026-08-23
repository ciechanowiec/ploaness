// Test execution and the production build. The runner is the project's own Vitest instance, never the
// harness copy: the project's specs import vitest directly, and a second copy would load a different
// module registry and fail to match its own matchers.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { type Context, resolveProjectTool } from '../context.js'
import {
  asFindings,
  failed,
  fromRun,
  type GateResult,
  passed,
  type RunResult,
  run,
} from '../exec.js'

// A Payload suite needs a database before it can boot, and how the project obtains one is a fact ploaness
// cannot know. The project declares it; the thresholds and the gate itself stay ploaness's.
const runPretest = (context: Context): RunResult | undefined => {
  const [command, ...rest] = context.settings.pretest
  if (command === undefined) {
    return undefined
  }
  return run(command, rest, { cwd: context.root })
}

interface Invocation {
  readonly command: string
  readonly commandArguments: readonly string[]
}

const wrapped = (context: Context, interpreterArguments: readonly string[]): Invocation => {
  const [wrapper, ...wrapperRest] = context.settings.testWrapper
  if (wrapper === undefined) {
    return { command: process.execPath, commandArguments: interpreterArguments }
  }
  return {
    command: wrapper,
    commandArguments: [...wrapperRest, process.execPath, ...interpreterArguments],
  }
}

const withPretest = (context: Context, gate: () => GateResult): GateResult => {
  const pretest: RunResult | undefined = runPretest(context)
  if (pretest !== undefined && pretest.code !== 0) {
    return failed('the declared pretest command failed', asFindings(pretest.output))
  }
  return gate()
}

/** Run the unit and integration suite with coverage, at the ploaness thresholds. */
export const tests = (context: Context): GateResult =>
  withPretest(context, (): GateResult => {
    let vitest: string
    try {
      vitest = resolveProjectTool(context, 'vitest')
    } catch {
      return failed('vitest could not be resolved from the project', [
        'the project must declare vitest itself, because its specs import it directly',
      ])
    }
    const invocation: Invocation = wrapped(context, [vitest, 'run', '--coverage'])
    return fromRun(
      run(invocation.command, invocation.commandArguments, {
        cwd: context.root,
        env: { NODE_OPTIONS: '--no-deprecation' },
      }),
      'the suite passes and meets the per-file coverage thresholds',
    )
  })

/** Run the Playwright end-to-end suite. */
export const endToEnd = (context: Context): GateResult => {
  if (!existsSync(path.join(context.root, 'playwright.config.ts'))) {
    return passed('the project declares no Playwright suite')
  }
  return withPretest(context, (): GateResult => {
    let playwright: string
    try {
      playwright = resolveProjectTool(context, '@playwright/test', 'playwright')
    } catch {
      return failed('@playwright/test could not be resolved from the project', [
        'the project must declare @playwright/test itself, because its specs import it directly',
      ])
    }
    const invocation: Invocation = wrapped(context, [
      playwright,
      'test',
      '--config=playwright.config.ts',
    ])
    return fromRun(
      run(invocation.command, invocation.commandArguments, {
        cwd: context.root,
        env: { NODE_OPTIONS: '--no-deprecation --import=tsx/esm' },
      }),
      'the end-to-end suite passes',
    )
  })
}

/** Produce the production build, which the bundle gate then measures. */
export const build = (context: Context): GateResult =>
  withPretest(context, (): GateResult => {
    let next: string
    try {
      next = resolveProjectTool(context, 'next')
    } catch {
      return failed('next could not be resolved from the project', [
        'a Payload application builds through Next, which the project must declare',
      ])
    }
    const invocation: Invocation = wrapped(context, [next, 'build'])
    return fromRun(
      run(invocation.command, invocation.commandArguments, {
        cwd: context.root,
        env: {
          NEXT_TELEMETRY_DISABLED: '1',
          NODE_OPTIONS: '--no-deprecation --max-old-space-size=8000',
        },
      }),
      'the production build succeeds',
    )
  })
