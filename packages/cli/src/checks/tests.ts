// Test execution and the production build. The runner is the project's own Vitest instance, never the
// harness copy: the project's specs import vitest directly, and a second copy would load a different
// module registry and fail to match its own matchers.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { CODE_EXTENSIONS, carriesSourceCode, hasExtension } from '@ploaness/governance'
import { type Context, type Member, resolveProjectTool, trackedFiles } from '../context.js'
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

// Resolution failure is an answer, not an exception to catch three times over.
const resolveProjectToolOrUndefined = (
  context: Context,
  tool: string,
  binary?: string,
): string | undefined => {
  try {
    return binary === undefined
      ? resolveProjectTool(context, tool)
      : resolveProjectTool(context, tool, binary)
  } catch {
    return undefined
  }
}

/** Run the unit and integration suite with coverage, at the ploaness thresholds. */
// A member that holds no first-party source has no suite to run, and a runner started there fails on an
// empty include - reporting a package with nothing to test as one that failed to test it. A member
// holding code and no suite is untouched by this and still fails.
const hasSourceToTest = (context: Member): boolean =>
  carriesSourceCode(trackedFiles(context.root), context.settings.sourceRoots, (filePath: string) =>
    hasExtension(filePath, CODE_EXTENSIONS),
  )

export const tests = (context: Member): GateResult =>
  withPretest(context, (): GateResult => {
    if (!hasSourceToTest(context)) {
      return passed('no first-party source in this package, so there is no suite to run')
    }
    const vitest: string | undefined = resolveProjectToolOrUndefined(context, 'vitest')
    if (vitest === undefined) {
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
      'the suite failed, or a file is below a coverage threshold',
    )
  })

/** Run the Playwright end-to-end suite. */
export const endToEnd = (context: Context): GateResult => {
  // Not optional, and no longer treated as such. ploaness ships the accessibility sweep as a managed
  // spec, so a project with no Playwright config is a project whose managed files are missing rather
  // than one that opted out; reporting a pass here would hide that behind a green gate.
  if (!existsSync(path.join(context.root, 'playwright.config.ts'))) {
    return failed('playwright.config.ts is missing, so the end-to-end suite cannot run', [
      'run `ploaness init` to write it, then `ploaness sync` to materialise the managed specs',
    ])
  }
  return withPretest(context, (): GateResult => {
    const playwright: string | undefined = resolveProjectToolOrUndefined(
      context,
      '@playwright/test',
      'playwright',
    )
    if (playwright === undefined) {
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
      'the end-to-end suite failed',
    )
  })
}

/** Produce the production build, which the bundle gate then measures. */
export const build = (context: Context): GateResult =>
  withPretest(context, (): GateResult => {
    const next: string | undefined = resolveProjectToolOrUndefined(context, 'next')
    if (next === undefined) {
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
      'the production build failed',
    )
  })
