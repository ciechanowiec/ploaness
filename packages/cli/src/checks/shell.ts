// ShellCheck over every shell script the repository tracks.
//
// A repository's operational scripts are code it runs against its own database and its own deployments,
// and nothing else in the harness reads them. The image is the one already pinned beside the other
// containerised analyzers, so this gate adds a rule rather than a dependency.
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  CONTAINER_IMAGES,
  findBlanketShellDirectives,
  type ShellDirective,
  shellScriptsIn,
} from '@ploaness/governance'
import { type Context, workingTreeFiles } from '../context.js'
import {
  asFindings,
  failed,
  type GateResult,
  passed,
  type RunResult,
  run,
  withOutput,
} from '../exec.js'
import { acquireImage, dockerFault } from './container-run.js'

const SHELLCHECK_IMAGE: string = CONTAINER_IMAGES.shellcheck
const SHELL_GATE: string = 'the shell gate'

/** ShellCheck exits 1 when it has findings; 2, 3 and 4 mean it could not analyse at all. */
const SHELLCHECK_FINDINGS: number = 1

// Read defensively and to a bounded set: `git ls-files` reports symlinks and gitlinks too, and the
// classifier asks only about paths whose extension could not already have answered. An unreadable file
// answers with no shebang, which leaves it out of scope rather than failing the run.
const readTextOrEmpty = (root: string, file: string): string => {
  try {
    const full: string = path.join(root, file)
    return statSync(full).isFile() ? readFileSync(full, 'utf8') : ''
  } catch {
    return ''
  }
}

const firstLineReader =
  (root: string) =>
  (file: string): string =>
    readTextOrEmpty(root, file).split('\n', 1)[0] ?? ''

const blanketFindings = (context: Context, scripts: readonly string[]): readonly string[] =>
  scripts.flatMap((file: string): readonly string[] =>
    findBlanketShellDirectives(readTextOrEmpty(context.root, file)).map(
      (directive: ShellDirective): string =>
        `${file}:${String(directive.line)} disables shellcheck wholesale with ` +
        `"disable=${directive.directive}"; name the codes a line genuinely needs, or repair the finding`,
    ),
  )

// ShellCheck has three outcomes rather than two, so `fromRun` cannot express the verdict: 0 is a pass, 1
// is a finding about the project, and 2, 3 and 4 mean it could not read what it was given. Reporting the
// last as a project defect is the misattribution the docker classifier exists to prevent.
const shellcheckFault = (result: RunResult): GateResult | undefined =>
  result.code === 0 || result.code === SHELLCHECK_FINDINGS
    ? undefined
    : failed(`${SHELL_GATE} could not analyse the scripts it was given`, asFindings(result.output))

/** Run the pinned ShellCheck over every tracked shell script. */
export const shell = (context: Context): GateResult => {
  const scripts: readonly string[] = shellScriptsIn(
    workingTreeFiles(context.root),
    firstLineReader(context.root),
  )
  // No script means no container: a project that ships none never needs the image at all.
  if (scripts.length === 0) {
    return passed('the project ships no shell script')
  }
  const blanket: readonly string[] = blanketFindings(context, scripts)
  const unavailable: GateResult | undefined = acquireImage(context, SHELLCHECK_IMAGE, SHELL_GATE)
  if (unavailable !== undefined) {
    return unavailable
  }
  // `--norc` is the load-bearing flag. Without it ShellCheck reads a `.shellcheckrc` from each script's
  // directory and every parent, so a committed `disable=all` would silence this gate from inside the
  // tree it judges - the shadowing the harness already refuses for every other analyzer. `--` keeps a
  // tracked file whose name begins with a dash from being read as an option, and the default severity
  // stands, because a check has two verdicts and neither of them is a warning.
  const result: RunResult = run(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${context.root}:/mnt:ro`,
      '--workdir',
      '/mnt',
      SHELLCHECK_IMAGE,
      '--norc',
      '--',
      ...scripts,
    ],
    { cwd: context.root },
  )
  const faulted: GateResult | undefined =
    dockerFault(context, SHELLCHECK_IMAGE, SHELL_GATE, result) ?? shellcheckFault(result)
  if (faulted !== undefined) {
    return faulted
  }
  const findings: readonly string[] = [
    ...blanket,
    ...(result.code === SHELLCHECK_FINDINGS ? asFindings(result.output) : []),
  ]
  return withOutput(
    findings.length > 0
      ? failed(`${String(findings.length)} shell script defect(s)`, findings)
      : passed(`${String(scripts.length)} shell script(s) pass shellcheck`),
    result.output,
  )
}
