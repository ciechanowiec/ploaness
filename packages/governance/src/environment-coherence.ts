// Environment-coherence policy: the pure logic that finds an environment variable declared in one place
// and missing from another it must also reach. The `environment` gate in
// packages/cli/src/checks/environment.ts reads the files.
//
// A variable lands in more than one place by nature, and nothing links those places. The application
// reads it, `.env.example` documents it for a clone, a compose file interpolates it, and a workflow
// exports it into the job. Miss one and the failure is somewhere other than where the omission is: a
// clone boots on a default it never chose, or `docker compose config` fails on CI alone, several steps
// from the commit that added the name. This is the sibling of document-references.ts and
// config-references.ts, applied to environment variables instead of scripts, docs, or config paths.
//
// EVERY RULE IS ONE-DIRECTIONAL, which is what makes the gate false-positive-free. What is read, or
// interpolated, must be documented; what is documented need not be read. `.env.example` legitimately
// carries an optional variable no code path requires - a key for a manual script, a value only a
// developer regenerating an asset ever sets - and demanding the reverse containment would report those
// as rot.
//
// It is NOT a YAML parser and must not become one, for the reason yaml-blocks.ts states. The workflow
// half asks only whether a name appears in the file at all, not whether it appears in the block that
// would put it in the job's environment. That is deliberate: adjudicating YAML scoping would need a
// parser, and the mistake this gate exists to catch is forgetting the variable altogether rather than
// declaring it one nesting level from where it was needed. Over-accepting costs a missed finding;
// guessing at scope would cost a wrong one.

/** Where a variable was declared, for a message that names the two places rather than one. */
export type EnvironmentOrigin = 'application' | 'compose'

/** An environment variable declared in one place and absent from another it has to reach. */
export interface EnvironmentViolation {
  readonly name: string
  readonly origin: EnvironmentOrigin
  readonly reason: string
}

/** A workflow, as the rule needs it: what to call it in a finding, and what it says. */
export interface WorkflowFile {
  readonly file: string
  readonly content: string
}

/** Inputs for {@link findEnvironmentViolations}, already read so the core stays pure. */
export interface EnvironmentInputs {
  /** The contents of every validated environment module the repository holds, one per member. */
  readonly applicationSources: readonly string[]
  /** The contents of the example file, or undefined when the repository ships none. */
  readonly example: string | undefined
  /** The contents of every compose file. */
  readonly composeSources: readonly string[]
  /** Every workflow the repository ships. Only the verifying ones are judged. */
  readonly workflows: readonly WorkflowFile[]
}

/**
 * The module a Payload project reads `process.env` in, which is the only module ploaness exempts from
 * the ban and therefore the only one this rule can read a variable name out of.
 */
export const VALIDATED_ENVIRONMENT_MODULE: string = 'src/lib/environment.ts'

/**
 * Every module exempt from the `process.env` ban.
 *
 * `src/proxy.ts` is exempt for a structural reason rather than a convenience one - Next mandates the
 * file and runs it in the edge runtime, where the validated module is not reachable - and what it reads
 * there is `NODE_ENV`, which the framework sets. So it is exempt from the LINT rule and is deliberately
 * not read by this one: it holds no project configuration to document.
 */
export const ENVIRONMENT_READ_EXEMPTIONS: readonly string[] = [
  VALIDATED_ENVIRONMENT_MODULE,
  'src/proxy.ts',
]

/**
 * The example files a repository may document its environment in, most conventional first.
 *
 * A list rather than one name because the convention is not universal, and a project using
 * `.env.sample` has documented its variables just as well as one using `.env.example`.
 */
export const ENVIRONMENT_EXAMPLE_FILES: readonly string[] = [
  '.env.example',
  '.env.sample',
  '.env.template',
]

// BRACKET ACCESS ONLY, and that is the rule rather than a shortcut. `process.env` is an index
// signature, so a variable this project invented can only be read with brackets; a variable node or the
// framework DECLARES - `NODE_ENV` above all - is a known property and is read with a dot. The two forms
// therefore separate project configuration, which `.env.example` owes a reader, from the ambient
// variables a runtime sets and no example file should claim to document.
const BRACKETED_READ: RegExp = /process\.env\[\s*(?<quote>['"])(?<name>[A-Za-z_]\w*)\k<quote>\s*\]/g

// A dotenv assignment: a name at the start of a line, optionally exported, followed by `=`. A comment
// line cannot match, because `#` is not a name character.
const EXAMPLE_ASSIGNMENT: RegExp = /^[ \t]*(?:export[ \t]+)?(?<name>[A-Za-z_]\w*)[ \t]*=/gm

// A compose interpolation with NO default. `${NAME}` must be supplied; `${NAME:-5432}` and `${NAME-x}`
// supply themselves, and `${NAME:?message}` declares its own failure, so none of the three is this
// gate's business. The braced form alone is read: `$NAME` is legal in compose and rare in practice, and
// telling it apart from a `$$` escape or a shell fragment inside a `command:` is guesswork.
const COMPOSE_INTERPOLATION: RegExp = /\$\{(?<name>[A-Z_]\w*)\}/gi

// A name a workflow supplies: a mapping key in SCREAMING_SNAKE, or a reference to a secret, a variable,
// or the job environment. The key form is matched at any indentation, for the reason the header states.
const WORKFLOW_KEY: RegExp = /^[ \t]*(?<name>[A-Z_][A-Z0-9_]*)[ \t]*:/gm
const WORKFLOW_CONTEXT_REFERENCE: RegExp =
  /\$\{\{[^}]*?\b(?:secrets|vars|env)\.(?<name>[A-Za-z_]\w*)/g

// What makes a workflow one whose job environment has to carry the compose variables: it runs a
// ploaness verification, and verification validates every compose file the repository ships. A workflow
// that publishes a release or labels an issue evaluates no compose file and is owed nothing.
const VERIFYING_COMMANDS: readonly string[] = ['ploaness verify', 'ploaness gate', 'run verify']

// Read through a NAMED group rather than a positional one. The bracketed-read pattern needs a
// back-reference to match a quote with its own kind, which puts the name in the second group and the
// quote in the first - a number that says nothing at the call site and that the magic-number rule is
// right to refuse. Every pattern here therefore captures into `name`.
const namesMatching = (source: string, pattern: RegExp): readonly string[] =>
  [...source.matchAll(pattern)].map((match: RegExpExecArray): string =>
    String(match.groups?.['name']),
  )

const uniqueSorted = (names: readonly string[]): readonly string[] =>
  [...new Set<string>(names)].sort((left: string, right: string): number =>
    left.localeCompare(right),
  )

/**
 * The variables an application reads out of its validated environment module.
 * @param source the contents of that module.
 * @returns each name once, sorted, so a finding list is deterministic.
 */
export const readEnvironmentNames = (source: string): readonly string[] =>
  uniqueSorted(namesMatching(source, BRACKETED_READ))

/**
 * The variables an example file documents.
 * @param example the contents of the example file.
 * @returns each name once, sorted.
 */
export const documentedEnvironmentNames = (example: string): readonly string[] =>
  uniqueSorted(namesMatching(example, EXAMPLE_ASSIGNMENT))

/**
 * The variables a compose file interpolates without supplying a default.
 * @param compose the contents of the compose file.
 * @returns each name once, sorted.
 */
export const interpolatedEnvironmentNames = (compose: string): readonly string[] =>
  uniqueSorted(namesMatching(compose, COMPOSE_INTERPOLATION))

/**
 * The variables a workflow supplies, by any means and at any nesting depth.
 * @param workflow the contents of the workflow file.
 * @returns each name once, sorted.
 */
export const workflowSuppliedNames = (workflow: string): readonly string[] =>
  uniqueSorted([
    ...namesMatching(workflow, WORKFLOW_KEY),
    ...namesMatching(workflow, WORKFLOW_CONTEXT_REFERENCE),
  ])

/**
 * Whether a workflow runs a ploaness verification, and therefore evaluates the compose files.
 * @param workflow the contents of the workflow file.
 * @returns true when the workflow invokes verification or a single gate.
 */
export const isVerifyingWorkflow = (workflow: string): boolean =>
  VERIFYING_COMMANDS.some((command: string): boolean => workflow.includes(command))

const undocumented = (
  names: readonly string[],
  documented: ReadonlySet<string>,
  origin: EnvironmentOrigin,
  reason: string,
): readonly EnvironmentViolation[] =>
  names
    .filter((name: string): boolean => !documented.has(name))
    .map((name: string): EnvironmentViolation => ({ name, origin, reason }))

const missingFromWorkflow = (
  names: readonly string[],
  workflow: WorkflowFile,
): readonly EnvironmentViolation[] => {
  const supplied: ReadonlySet<string> = new Set(workflowSuppliedNames(workflow.content))
  return names
    .filter((name: string): boolean => !supplied.has(name))
    .map(
      (name: string): EnvironmentViolation => ({
        name,
        origin: 'compose',
        reason: [
          'interpolated by a compose file but not supplied by',
          `${workflow.file}, where verification will evaluate it`,
        ].join(' '),
      }),
    )
}

/**
 * Every environment variable declared in one place and absent from another it has to reach.
 *
 * Three containments, each one-directional. What the application reads must be documented. What a
 * compose file interpolates must be documented, because `docker compose config` reads the example file
 * a developer copied. And what a compose file interpolates must be supplied by every workflow that
 * verifies, because a workflow has no copied file to interpolate from.
 * @param inputs the files, already read.
 * @returns the violations, sorted by name within each rule. An empty array means the four places agree.
 */
export const findEnvironmentViolations = (
  inputs: EnvironmentInputs,
): readonly EnvironmentViolation[] => {
  const documented: ReadonlySet<string> = new Set(
    inputs.example === undefined ? [] : documentedEnvironmentNames(inputs.example),
  )
  const read: readonly string[] = uniqueSorted(
    inputs.applicationSources.flatMap((source: string): readonly string[] =>
      readEnvironmentNames(source),
    ),
  )
  const interpolated: readonly string[] = uniqueSorted(
    inputs.composeSources.flatMap((source: string): readonly string[] =>
      interpolatedEnvironmentNames(source),
    ),
  )
  const verifying: readonly WorkflowFile[] = inputs.workflows.filter(
    (workflow: WorkflowFile): boolean => isVerifyingWorkflow(workflow.content),
  )
  return [
    ...undocumented(
      read,
      documented,
      'application',
      'read by the validated environment module but documented in no example file',
    ),
    ...undocumented(
      interpolated,
      documented,
      'compose',
      'interpolated by a compose file but documented in no example file',
    ),
    ...verifying.flatMap((workflow: WorkflowFile): readonly EnvironmentViolation[] =>
      missingFromWorkflow(interpolated, workflow),
    ),
  ]
}
