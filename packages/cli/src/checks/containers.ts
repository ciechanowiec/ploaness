// The gates that run their tool inside Docker. A Payload project already needs Docker for its database,
// so this costs nothing extra and makes the gates behave identically on every machine: no local install
// of gitleaks, hadolint, or actionlint, and no version skew between developers and CI.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  CONTAINER_IMAGES,
  type ComposeProject,
  composeProjectsIn,
  dockerfilesIn,
  renderGitleaksConfig,
} from '@ploaness/governance'
import { type Context, trackedFiles } from '../context.js'
import {
  asFindings,
  COMMAND_NOT_FOUND,
  failed,
  fromRun,
  type GateResult,
  passed,
  type RunResult,
  run,
} from '../exec.js'

// Pinned by digest in the governance layer, where a spec rejects a mutable reference. These were three
// `:latest` literals, which let an upstream release change a verdict without the repository changing.
const GITLEAKS_IMAGE: string = CONTAINER_IMAGES.gitleaks
const HADOLINT_IMAGE: string = CONTAINER_IMAGES.hadolint
const ACTIONLINT_IMAGE: string = CONTAINER_IMAGES.actionlint

const isDockerMissing = (result: RunResult): boolean =>
  result.code === COMMAND_NOT_FOUND || result.output.includes('ENOENT')

const requireDocker = (result: RunResult, gate: string): GateResult | undefined =>
  isDockerMissing(result)
    ? failed(`${gate} needs Docker, which is not available`, [
        'Docker is already required for the Payload test database; start it and retry',
      ])
    : undefined

// The scanner's configuration is rendered outside the working tree and mounted read-only. A copy in the
// tree is a forbidden path, because it could shadow or weaken the tool's own rules; rendering it here
// means the project supplies data - which fixture credential, and why - while ploaness keeps the rules.
//
// Rendered under the home directory rather than the system temporary directory: a macOS Docker daemon
// shares the home directory and need not share /tmp, and an unshared source mounts as an empty
// directory rather than as an error. `it/verify.sh` records the same constraint for the same reason.
const withRenderedConfig = <Value>(
  context: Context,
  use: (configDirectory: string) => Value,
): Value => {
  const directory: string = mkdtempSync(path.join(homedir(), '.ploaness-secrets-'))
  try {
    writeFileSync(
      path.join(directory, 'gitleaks.toml'),
      renderGitleaksConfig(context.settings.secretAllowlist),
    )
    return use(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const scanSecrets = (context: Context, configDirectory: string, target: string): RunResult =>
  run(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${context.root}:/repo`,
      '-v',
      `${configDirectory}:/ploaness:ro`,
      GITLEAKS_IMAGE,
      target,
      '/repo',
      '--config',
      '/ploaness/gitleaks.toml',
      '--no-banner',
      '--redact',
    ],
    { cwd: context.root },
  )

/** Scan the commit history for committed secrets. */
export const secrets = (context: Context): GateResult =>
  withRenderedConfig(context, (configDirectory: string): GateResult => {
    // `git` mode, not `dir`. The standard asks for the tracked content and the commit history, and
    // history mode covers both: every tracked file's content is in some commit. `dir` mode has no git
    // awareness at all - it reads `node_modules`, the build output, and a local `.env`, none of which
    // the repository tracks or owns. On a real Payload project that was 1.09 GB against 2 MB, sixty
    // times slower, and every finding it added came from a dependency rather than from this project.
    const history: RunResult = scanSecrets(context, configDirectory, 'git')
    return (
      requireDocker(history, 'the secret scan') ??
      fromRun(
        history,
        'no secret found in the git history',
        'the scanner found a secret in the git history',
      )
    )
  })

// Both kinds are discovered from the tracked tree, by the rules in `governance`. The compose half used to
// look at the repository root alone, so a project keeping its application - and its compose file - in a
// member directory had that file validated by nothing, while the Dockerfile beside it was linted.
const dockerfiles = (context: Context): readonly string[] =>
  dockerfilesIn(trackedFiles(context.root))

const composeProjects = (context: Context): readonly ComposeProject[] =>
  composeProjectsIn(trackedFiles(context.root))

// Compose ships both as a `docker` subcommand and as a standalone binary, and which one a machine has is
// not a property of the project. Try the modern form first and accept the legacy one, failing only when
// neither can validate the file.
//
// Run from the project's own directory rather than from the repository root, because that is what decides
// what compose reads: the override files beside it, the `.env` it interpolates from, and the build
// contexts its relative paths name.
const validateCompose = (directory: string): RunResult => {
  const modern: RunResult = run('sh', ['-c', 'docker compose config > /dev/null'], {
    cwd: directory,
  })
  return modern.code === 0
    ? modern
    : run('sh', ['-c', 'docker-compose config > /dev/null'], { cwd: directory })
}

interface ValidatedCompose {
  readonly project: ComposeProject
  readonly result: RunResult
}

const validateComposeProjects = (
  context: Context,
  projects: readonly ComposeProject[],
): readonly ValidatedCompose[] =>
  projects.map(
    (project: ComposeProject): ValidatedCompose => ({
      project,
      result: validateCompose(path.join(context.root, project.directory)),
    }),
  )

// A missing daemon is reported as itself rather than as a pile of findings about files no tool could
// read. It is asked of the compose results too, which it was not: a project shipping only a compose file
// met a missing Docker as shell noise from a command that never ran.
const firstMissingDaemon = (results: readonly RunResult[]): GateResult | undefined =>
  results
    .map((result: RunResult): GateResult | undefined => requireDocker(result, 'the container gate'))
    .find((entry: GateResult | undefined): boolean => entry !== undefined)

interface LintedDockerfile {
  readonly target: string
  readonly result: RunResult
}

// The file is fed on stdin through the argv form rather than through a shell redirection. It used to be
// interpolated into an `sh -c` string with `JSON.stringify` around it, which is JSON quoting and not
// shell quoting: inside double quotes `sh` still expands `$`, a backtick, and a backslash, so a tracked
// file named `Dockerfile.$(...)` ran its own contents on every verification.
const lintDockerfile = (context: Context, target: string): RunResult =>
  run('docker', ['run', '--rm', '-i', HADOLINT_IMAGE], {
    cwd: context.root,
    input: readFileSync(path.join(context.root, target), 'utf8'),
  })

// What the gate actually looked at, so a pass never claims more than it checked. The summary read
// "N Dockerfile(s) and the compose file are valid" whether or not a compose file existed.
const describeTargets = (dockerfileCount: number, composeCount: number): string => {
  const parts: readonly string[] = [
    ...(dockerfileCount > 0 ? [`${String(dockerfileCount)} Dockerfile(s)`] : []),
    ...(composeCount > 0 ? [`${String(composeCount)} compose project(s)`] : []),
  ]
  return parts.length === 0
    ? 'the project ships no container definition'
    : `${parts.join(' and ')} are valid`
}

/** Lint every Dockerfile and validate every compose project. */
export const containers = (context: Context): GateResult => {
  const targets: readonly string[] = dockerfiles(context)
  const projects: readonly ComposeProject[] = composeProjects(context)
  // A project whose database comes from compose and whose app is built by Next ships no Dockerfile at
  // all - the common Payload layout. Returning here on that count alone meant its compose file was
  // never validated, and the gate reported a pass having read nothing.
  if (projects.length === 0 && targets.length === 0) {
    return passed('the project ships no container definition')
  }
  // Run every tool first, then judge.
  const linted: readonly LintedDockerfile[] = targets.map(
    (target: string): LintedDockerfile => ({ target, result: lintDockerfile(context, target) }),
  )
  const validated: readonly ValidatedCompose[] = validateComposeProjects(context, projects)
  const missing: GateResult | undefined = firstMissingDaemon([
    ...linted.map((entry: LintedDockerfile): RunResult => entry.result),
    ...validated.map((entry: ValidatedCompose): RunResult => entry.result),
  ])
  if (missing !== undefined) {
    return missing
  }
  const findings: readonly string[] = [
    ...linted.flatMap((entry: LintedDockerfile): readonly string[] =>
      entry.result.code === 0 ? [] : [`${entry.target}:`, ...asFindings(entry.result.output)],
    ),
    ...validated.flatMap((entry: ValidatedCompose): readonly string[] =>
      entry.result.code === 0 ? [] : [`${entry.project.file}:`, ...asFindings(entry.result.output)],
    ),
  ]
  return findings.length > 0
    ? failed('container definitions have defects', findings)
    : passed(describeTargets(targets.length, projects.length))
}

/** Lint the GitHub Actions workflows. */
export const actions = (context: Context): GateResult => {
  if (!existsSync(path.join(context.root, '.github', 'workflows'))) {
    return passed('the project ships no workflows')
  }
  const result: RunResult = run(
    'docker',
    ['run', '--rm', '-v', `${context.root}:/repo`, '--workdir', '/repo', ACTIONLINT_IMAGE],
    { cwd: context.root },
  )
  return (
    requireDocker(result, 'the workflow gate') ??
    fromRun(result, 'workflows pass actionlint', 'a workflow does not pass actionlint')
  )
}
