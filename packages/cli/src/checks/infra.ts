// OpenTofu and Terraform, judged by two readers with one owner each.
//
// The pattern rules decide what text can decide and nothing more; the curated analyzer decides what
// needs a resource graph. Both run here because a project that ships infrastructure ships it as code,
// and until now the harness read those files for secrets and whitespace and nothing else.
//
// Before either reader, the providers the tree declares are classified. A `--check` id that binds to
// no resource in the tree matches nothing and raises no error, so over a cloud the catalogue did not
// cover the analyzer exits 0 and a gate that did not look would report curated checks that never ran.
// A provider nobody classified is refused instead, and a provider the analyzer ships no check for is
// passed on the pattern rules with a summary that says exactly that.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  CONTAINER_IMAGES,
  checkovCheckList,
  checkovConfigsIn,
  checksFor,
  classifyProviders,
  findTerraformViolations,
  type ProviderClassification,
  type ProviderDeclaration,
  providerDeclarationsIn,
  providersOf,
  resourceCountOf,
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

interface SourceFile {
  readonly file: string
  readonly text: string
}

interface FileDeclaration extends ProviderDeclaration {
  readonly file: string
}

// Each source is read once and handed to both readers.
const readSources = (context: Context, files: readonly string[]): readonly SourceFile[] =>
  files.map(
    (file: string): SourceFile => ({
      file,
      text: readFileSync(path.join(context.root, file), 'utf8'),
    }),
  )

const patternFindingsIn = (sources: readonly SourceFile[]): readonly string[] =>
  sources.flatMap((source: SourceFile): readonly string[] =>
    findTerraformViolations(source.text).map(
      (violation: TerraformViolation): string =>
        `${source.file}:${String(violation.line)} [${violation.rule}] ${violation.reason}`,
    ),
  )

const declarationsIn = (sources: readonly SourceFile[]): readonly FileDeclaration[] =>
  sources.flatMap((source: SourceFile): readonly FileDeclaration[] =>
    providerDeclarationsIn(source.text).map(
      (declaration: ProviderDeclaration): FileDeclaration => ({
        ...declaration,
        file: source.file,
      }),
    ),
  )

const listed = (names: readonly string[]): string => names.join(', ')

const matchesFileAndProvider = (left: FileDeclaration, right: FileDeclaration): boolean =>
  left.file === right.file && left.provider === right.provider

// One finding per file and provider: the first line that declares it is enough to act on.
const firstDeclarations = (
  declarations: readonly FileDeclaration[],
  providers: readonly string[],
): readonly FileDeclaration[] =>
  declarations.filter(
    (declaration: FileDeclaration, index: number): boolean =>
      providers.includes(declaration.provider) &&
      declarations.findIndex((other: FileDeclaration): boolean =>
        matchesFileAndProvider(other, declaration),
      ) === index,
  )

// Refusing to guess is the point. The repair sits in ploaness rather than in the project, and the
// finding says so rather than sending an agent looking for an argument to change. The pattern rules
// already ran, and their findings are real, so they are reported beneath.
const unclassifiedFailure = (
  standing: ProviderClassification,
  declarations: readonly FileDeclaration[],
  patterns: readonly string[],
): GateResult =>
  failed(`provider(s) this harness has not classified: ${listed(standing.unclassified)}`, [
    ...firstDeclarations(declarations, standing.unclassified).map(
      (declaration: FileDeclaration): string =>
        `${declaration.file}:${String(declaration.line)} declares ${declaration.subject}, and ` +
        `this harness has not classified the ${declaration.provider} provider`,
    ),
    'classify each provider in ploaness (packages/governance/src/checkov-policy.ts); the harness ' +
      'refuses to guess whether the analyzer covers it',
    ...(patterns.length === 0 ? [] : ['the pattern rules also found the following:', ...patterns]),
  ])

// Why no analyzer ran, in the summary's own words. Only the standings actually present are named.
const standingClause = (standing: ProviderClassification): string => {
  const clauses: readonly string[] = [
    ...(standing.unsupported.length === 0
      ? []
      : [`the analyzer ships no check for ${listed(standing.unsupported)}`]),
    ...(standing.audited.length === 0
      ? []
      : [`no check for ${listed(standing.audited)} met the rubric`]),
  ]
  return clauses.length === 0
    ? `only utility providers are declared (${listed(standing.utility)})`
    : clauses.join('; ')
}

// `21 aws curated check(s)`, or `21 aws and 30 google curated check(s)`: the count of what could have
// applied, which is the claim a pass is entitled to make.
const checkClause = (curated: readonly string[]): string =>
  `${curated
    .map((provider: string): string => `${String(checksFor([provider]).length)} ${provider}`)
    .join(' and ')} curated check(s)`

const patternVerdict = (patterns: readonly string[], summary: string): GateResult =>
  patterns.length === 0
    ? passed(summary)
    : failed(`${String(patterns.length)} infrastructure defect(s)`, patterns)

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
//
// The whole catalogue is sent, not the subset for the providers found. A check never fires on a
// resource type it does not bind to, so the verdict is the same either way - and a detection miss
// then costs a wrong count in the summary rather than a check that silently did not run.
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

const analyze = (
  context: Context,
  patterns: readonly string[],
  passSummary: string,
): GateResult => {
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
    findings.length === 0
      ? passed(passSummary)
      : failed(`${String(findings.length)} infrastructure defect(s)`, findings),
    result.output,
  )
}

// What the tree declares decides whether the analyzer runs at all. A tree of variables and modules
// declares nothing it could judge; a tree on a cloud it has no check for would pass without looking.
// Neither pulls an image, and neither claims a check it did not run.
const judge = (
  context: Context,
  sources: readonly SourceFile[],
  declarations: readonly FileDeclaration[],
  standing: ProviderClassification,
): GateResult => {
  const patterns: readonly string[] = patternFindingsIn(sources)
  if (standing.unclassified.length > 0) {
    return unclassifiedFailure(standing, declarations, patterns)
  }
  const files: string = `${String(sources.length)} infrastructure file(s)`
  const resources: number = resourceCountOf(declarations)
  if (resources === 0) {
    return patternVerdict(
      patterns,
      `${files} declare no resource this harness can judge; the pattern rules pass`,
    )
  }
  if (standing.curated.length === 0) {
    return patternVerdict(patterns, `${files} pass the pattern rules; ${standingClause(standing)}`)
  }
  return analyze(
    context,
    patterns,
    `${files} declaring ${String(resources)} resource(s) pass ` +
      `${checkClause(standing.curated)} and the pattern rules`,
  )
}

/** Judge every OpenTofu and Terraform source the repository tracks. */
export const infrastructure = (context: Context): GateResult => {
  const tracked: readonly string[] = workingTreeFiles(context.root)
  const files: readonly string[] = terraformFilesIn(tracked)
  // No infrastructure means no container: a project that ships none never needs the image.
  if (files.length === 0) {
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
  const sources: readonly SourceFile[] = readSources(context, files)
  const declarations: readonly FileDeclaration[] = declarationsIn(sources)
  return judge(context, sources, declarations, classifyProviders(providersOf(declarations)))
}
