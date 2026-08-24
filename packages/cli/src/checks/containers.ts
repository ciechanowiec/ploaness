// The gates that run their tool inside Docker. A Payload project already needs Docker for its database,
// so this costs nothing extra and makes the gates behave identically on every machine: no local install
// of gitleaks, hadolint, or actionlint, and no version skew between developers and CI.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { CONTAINER_IMAGES, renderGitleaksConfig } from '@ploaness/governance'
import { type Context, trackedFiles } from '../context.js'
import {
  asFindings,
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

// The exit status a shell reports when the command itself could not be found.
const COMMAND_NOT_FOUND: number = 127

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
      fromRun(history, 'no secret found in the git history')
    )
  })

// Discovered from the tracked tree rather than from a fixed list: a project may keep a Dockerfile in any
// directory, and a hard-coded path would silently skip the ones it did not anticipate.
const isDockerfile = (file: string): boolean => {
  const name: string = path.basename(file)
  return name === 'Dockerfile' || name.endsWith('.Dockerfile') || name.startsWith('Dockerfile.')
}

const dockerfiles = (context: Context): readonly string[] =>
  trackedFiles(context.root)
    .filter((file: string): boolean => isDockerfile(file))
    .toSorted((left: string, right: string): number => left.localeCompare(right))

// Compose ships both as a `docker` subcommand and as a standalone binary, and which one a machine has is
// not a property of the project. Try the modern form first and accept the legacy one, failing only when
// neither can validate the file.
const COMPOSE_FILES: readonly string[] = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
]

const validateCompose = (root: string): RunResult => {
  const modern: RunResult = run('sh', ['-c', 'docker compose config > /dev/null'], { cwd: root })
  return modern.code === 0
    ? modern
    : run('sh', ['-c', 'docker-compose config > /dev/null'], { cwd: root })
}

/** Validate the compose file, if the project ships one. */
const composeFindings = (context: Context): readonly string[] => {
  const composeFile: string | undefined = COMPOSE_FILES.find((file: string): boolean =>
    existsSync(path.join(context.root, file)),
  )
  if (composeFile === undefined) {
    return []
  }
  const compose: RunResult = validateCompose(context.root)
  return compose.code === 0 ? [] : [`${composeFile}:`, ...asFindings(compose.output)]
}

interface LintedDockerfile {
  readonly target: string
  readonly result: RunResult
}

/** Lint every Dockerfile and validate the compose file. */
export const containers = (context: Context): GateResult => {
  const targets: readonly string[] = dockerfiles(context)
  if (targets.length === 0) {
    return passed('the project ships no Dockerfile')
  }
  // Lint every Dockerfile first, then judge. A missing daemon is reported as itself rather than as a
  // pile of findings about files no tool could read.
  const linted: readonly LintedDockerfile[] = targets.map(
    (target: string): LintedDockerfile => ({
      target,
      result: run(
        'sh',
        ['-c', `docker run --rm -i ${HADOLINT_IMAGE} < ${JSON.stringify(target)}`],
        { cwd: context.root },
      ),
    }),
  )
  const missing: GateResult | undefined = linted
    .map((entry: LintedDockerfile): GateResult | undefined =>
      requireDocker(entry.result, 'the container gate'),
    )
    .find((entry: GateResult | undefined): boolean => entry !== undefined)
  if (missing !== undefined) {
    return missing
  }
  const findings: readonly string[] = [
    ...linted.flatMap((entry: LintedDockerfile): readonly string[] =>
      entry.result.code === 0 ? [] : [`${entry.target}:`, ...asFindings(entry.result.output)],
    ),
    ...composeFindings(context),
  ]
  return findings.length > 0
    ? failed('container definitions have defects', findings)
    : passed(`${String(targets.length)} Dockerfile(s) and the compose file are valid`)
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
  return requireDocker(result, 'the workflow gate') ?? fromRun(result, 'workflows pass actionlint')
}
