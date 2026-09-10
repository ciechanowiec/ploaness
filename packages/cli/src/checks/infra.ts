// OpenTofu and Terraform, judged by two readers with one owner each.
//
// The pattern rules decide what text can decide and nothing more; the curated analyzer decides what
// needs a resource graph. Both run here because a project that ships infrastructure ships it as code,
// and until now the harness read those files for secrets and whitespace and nothing else.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  CHECKOV_CHECKS,
  CONTAINER_IMAGES,
  checkovCheckList,
  checkovConfigsIn,
  findTerraformViolations,
  type TerraformViolation,
  terraformFilesIn,
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

const CHECKOV_IMAGE: string = CONTAINER_IMAGES.checkov
const INFRA_GATE: string = 'the infrastructure gate'

/** checkov exits 1 when a check failed; anything higher means it stopped before deciding. */
const CHECKOV_FINDINGS: number = 1

const patternFindingsIn = (context: Context, sources: readonly string[]): readonly string[] =>
  sources.flatMap((file: string): readonly string[] =>
    findTerraformViolations(readFileSync(path.join(context.root, file), 'utf8')).map(
      (violation: TerraformViolation): string =>
        `${file}:${String(violation.line)} [${violation.rule}] ${violation.reason}`,
    ),
  )

// checkov reserves 1 for a failed check. Every higher status is the tool stopping before it decided
// anything, and reading that as "the infrastructure is fine" - or as a defect - are both wrong.
const checkovFault = (result: RunResult): GateResult | undefined =>
  result.code === 0 || result.code === CHECKOV_FINDINGS
    ? undefined
    : failed(`${INFRA_GATE} could not complete its analyzer run`, asFindings(result.output))

// The pattern rules already ran when the image turns out to be unavailable, and their findings are
// real. Reporting the docker failure alone would throw away work that cost nothing, so both are
// returned with a line saying which half of the gate actually ran.
const withPatternFindings = (unavailable: GateResult, patterns: readonly string[]): GateResult =>
  patterns.length === 0
    ? unavailable
    : failed(unavailable.summary, [
        ...unavailable.findings,
        'the pattern rules ran and found the following; the analyzer did not:',
        ...patterns,
      ])

// `--workdir /` rather than the mounted tree, so nothing the project ships is the analyzer's working
// directory. `--framework terraform` keeps this gate to the one thing it owns: the dockerfile, secrets
// and workflow frameworks belong to gates that already run them. Never `--soft-fail`, which forces
// exit 0, and never `--no-fail-on-crash`, which turns a crash into a pass.
const runCheckov = (context: Context): RunResult =>
  run(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${context.root}:/repo:ro`,
      '--workdir',
      '/',
      CHECKOV_IMAGE,
      '--directory',
      '/repo',
      '--framework',
      'terraform',
      '--check',
      checkovCheckList(),
      '--compact',
      '--quiet',
      '--output',
      'cli',
    ],
    { cwd: context.root },
  )

/** Judge every OpenTofu and Terraform source the repository tracks. */
export const infrastructure = (context: Context): GateResult => {
  const tracked: readonly string[] = workingTreeFiles(context.root)
  const sources: readonly string[] = terraformFilesIn(tracked)
  // No infrastructure means no container: a project that ships none never needs the image.
  if (sources.length === 0) {
    return passed('the project ships no infrastructure definition')
  }
  // A committed configuration would turn the curated checks off from inside the tree they judge, which
  // is the shadowing the harness refuses for every other analyzer.
  const shadowing: readonly string[] = checkovConfigsIn(tracked)
  if (shadowing.length > 0) {
    return failed('a local analyzer configuration would shadow the infrastructure rules', [
      ...shadowing.map((file: string): string => `${file} configures the analyzer this gate runs`),
      'delete it; the checks this harness enables are not a project setting',
    ])
  }
  const patterns: readonly string[] = patternFindingsIn(context, sources)
  const unavailable: GateResult | undefined = acquireImage(context, CHECKOV_IMAGE, INFRA_GATE)
  if (unavailable !== undefined) {
    return withPatternFindings(unavailable, patterns)
  }
  const result: RunResult = runCheckov(context)
  const faulted: GateResult | undefined =
    dockerFault(context, CHECKOV_IMAGE, INFRA_GATE, result) ?? checkovFault(result)
  if (faulted !== undefined) {
    return faulted
  }
  const findings: readonly string[] = [
    ...patterns,
    ...(result.code === CHECKOV_FINDINGS ? asFindings(result.output) : []),
  ]
  return withOutput(
    findings.length > 0
      ? failed(`${String(findings.length)} infrastructure defect(s)`, findings)
      : passed(
          `${String(sources.length)} infrastructure file(s) pass ${String(CHECKOV_CHECKS.length)} ` +
            'curated checks and the pattern rules',
        ),
    result.output,
  )
}
