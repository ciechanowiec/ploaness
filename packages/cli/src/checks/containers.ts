// The gates that run their tool inside Docker. A Payload project already needs Docker for its database,
// so this costs nothing extra and makes the gates behave identically on every machine: no local install
// of gitleaks, Vale, hadolint, or actionlint, and no version skew between developers and CI.
import { existsSync } from 'node:fs'
import path from 'node:path'
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

const GITLEAKS_IMAGE: string = 'zricethezav/gitleaks:latest'
const VALE_IMAGE: string = 'jdkato/vale:v3.15.1'
const HADOLINT_IMAGE: string = 'hadolint/hadolint:latest'
const ACTIONLINT_IMAGE: string = 'rhysd/actionlint:latest'

const dockerMissing = (result: RunResult): boolean =>
  result.code === 127 || result.output.includes('ENOENT')

const requireDocker = (result: RunResult, gate: string): GateResult | undefined =>
  dockerMissing(result)
    ? failed(`${gate} needs Docker, which is not available`, [
        'Docker is already required for the Payload test database; start it and retry',
      ])
    : undefined

/** Scan git-tracked content for committed secrets. */
export const secrets = (context: Context): GateResult => {
  const result: RunResult = run(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${context.root}:/repo`,
      GITLEAKS_IMAGE,
      'git',
      '/repo',
      '--no-banner',
      '--redact',
    ],
    { cwd: context.root },
  )
  return (
    requireDocker(result, 'the secret scan') ?? fromRun(result, 'no secret found in git history')
  )
}

const README: string = 'README.adoc'

/** The Vale configuration a project writes for itself, at the repository root. */
const VALE_CONFIG: string = '.vale.ini'

/**
 * Lint the project README with Vale, using the project's own configuration and styles.
 *
 * Prose rules are the one part of the contract ploaness does not dictate. A house style is a decision
 * about voice, terminology, and audience, and a harness that shipped one would be imposing an editorial
 * opinion under the cover of a quality gate. So the project writes `.vale.ini` and owns whatever styles
 * it points at; ploaness only insists that whatever the project chose actually passes.
 *
 * A project without `.vale.ini` has made no such choice, and this gate passes rather than inventing one.
 * That is not a hole a project can hide in: dropping the file is a visible, reviewable deletion, which is
 * a different thing from a rule that silently stopped applying.
 */
export const prose = (context: Context): GateResult => {
  if (!existsSync(path.join(context.root, README))) {
    return failed(`${README} is missing`, ['the project README must exist at the repository root'])
  }
  if (!existsSync(path.join(context.root, VALE_CONFIG))) {
    return passed(`no ${VALE_CONFIG}, so the project declares no prose rules to enforce`)
  }
  const result: RunResult = run(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${context.root}:/repo:ro`,
      '-w',
      '/repo',
      VALE_IMAGE,
      `--config=/repo/${VALE_CONFIG}`,
      // Fail on any alert rather than only error-level ones, so "passes Vale" means a fully clean report.
      '--minAlertLevel=suggestion',
      README,
    ],
    { cwd: context.root },
  )
  return (
    requireDocker(result, 'the prose gate') ??
    (result.code === 0
      ? passed(`${README} passes Vale with no alerts`)
      : failed(`Vale reported alerts in ${README}`, asFindings(result.output)))
  )
}

// Discovered from the tracked tree rather than from a fixed list: a project may keep a Dockerfile in any
// directory, and a hard-coded path would silently skip the ones it did not anticipate.
const isDockerfile = (file: string): boolean => {
  const name: string = path.basename(file)
  return name === 'Dockerfile' || name.endsWith('.Dockerfile') || name.startsWith('Dockerfile.')
}

const dockerfiles = (context: Context): readonly string[] =>
  trackedFiles(context.root).filter(isDockerfile).toSorted()

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

/** Lint every Dockerfile and validate the compose file. */
export const containers = (context: Context): GateResult => {
  const targets: readonly string[] = dockerfiles(context)
  if (targets.length === 0) {
    return passed('the project ships no Dockerfile')
  }
  const findings: string[] = []
  for (const target of targets) {
    const result: RunResult = run(
      'sh',
      ['-c', `docker run --rm -i ${HADOLINT_IMAGE} < ${JSON.stringify(target)}`],
      { cwd: context.root },
    )
    const missing: GateResult | undefined = requireDocker(result, 'the container gate')
    if (missing !== undefined) {
      return missing
    }
    if (result.code !== 0) {
      findings.push(`${target}:`, ...asFindings(result.output))
    }
  }
  const composeFile: string | undefined = COMPOSE_FILES.find((file: string): boolean =>
    existsSync(path.join(context.root, file)),
  )
  if (composeFile !== undefined) {
    const compose: RunResult = validateCompose(context.root)
    if (compose.code !== 0) {
      findings.push(`${composeFile}:`, ...asFindings(compose.output))
    }
  }
  return findings.length > 0
    ? failed('container definitions have defects', findings)
    : passed(`${targets.length} Dockerfile(s) and the compose file are valid`)
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
