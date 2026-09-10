// Require environment reads, example declarations, compose interpolation, verifying workflows, and the
// build arguments an image declares to agree.
import { logicalLines } from './container-images.js'

/** Where a variable was declared, for a message that names the two places rather than one. */
export type EnvironmentOrigin = 'application' | 'compose' | 'dockerfile'

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

/** A Dockerfile, as the rule needs it: what to call it in a finding, and what it declares. */
export interface DockerfileSource {
  readonly file: string
  readonly content: string
}

/** One member's image build: the files whose reads it inlines, and the Dockerfiles that build it. */
export interface ImageBuild {
  /** Contents of the validated module and the framework configuration, where the member has them. */
  readonly sources: readonly string[]
  /** Every Dockerfile that builds this member. Empty when the member ships no image. */
  readonly dockerfiles: readonly DockerfileSource[]
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
  /** One entry per member: what its build inlines, and the images that must declare it. */
  readonly builds: readonly ImageBuild[]
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

/**
 * The framework configuration a member may hold at its own root.
 *
 * It is evaluated during the image build, so a variable it reads is one the build has to be given - and
 * it sits outside `sourceRoots`, which is why the `process.env` ban never reached it and why this rule
 * has to. Every spelling present is read, unlike the example files above, because a project ships one
 * and reading all of them cannot produce two answers that disagree.
 */
export const BUILD_CONFIGURATION_FILES: readonly string[] = [
  'next.config.ts',
  'next.config.mjs',
  'next.config.js',
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

// BOTH ACCESS FORMS, and the PREFIX is what makes that sound rather than a relaxation of the rule
// above. `NEXT_PUBLIC_` is reserved by the framework for values the project invents; no runtime declares
// one, so a dotted read of a prefixed name cannot be naming an ambient variable the way
// `process.env.NODE_ENV` does. It is also the ONLY form the bundler substitutes, because the
// substitution is textual - so the dotted read is not merely admissible here, it is the read that makes
// the value a build input at all. A name read through a plain record parameter is not matched: nothing
// is inlined there, and the value arrives from whoever built the record.
const INLINED_DOTTED_READ: RegExp = /process\.env\.(?<name>NEXT_PUBLIC_\w+)/g
const INLINED_BRACKETED_READ: RegExp =
  /process\.env\[\s*(?<quote>['"])(?<name>NEXT_PUBLIC_\w+)\k<quote>\s*\]/g

// A build-argument DECLARATION, with or without a default. The compose analogue above puts
// `${NAME:-5432}` out of scope because a default SUPPLIES the value and the claim was that something
// must supply it. This containment runs the other way - the Dockerfile is the side that must DECLARE -
// and `ARG NAME=x` declares NAME just as `ARG NAME` does: `--build-arg NAME=...` is honoured either way
// and the read resolves. What this rule is about is a name the file never mentions.
const ARG_DECLARATION: RegExp = /^[ \t]*ARG[ \t]+(?<names>\S.*)$/i
const ARGUMENT_SEPARATOR: RegExp = /[ \t]+/
const DEFAULT_SEPARATOR: string = '='

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
 * The variables a file's reads inline into the image at build time.
 * @param source the contents of a validated environment module or a framework configuration.
 * @returns each name once, sorted.
 */
export const inlinedEnvironmentNames = (source: string): readonly string[] =>
  uniqueSorted([
    ...namesMatching(source, INLINED_DOTTED_READ),
    ...namesMatching(source, INLINED_BRACKETED_READ),
  ])

const argumentNamesIn = (declaration: string): readonly string[] =>
  declaration
    .split(ARGUMENT_SEPARATOR)
    .map((token: string): string => token.split(DEFAULT_SEPARATOR)[0] ?? '')
    .filter((name: string): boolean => name.length > 0)

/**
 * The build arguments a Dockerfile declares, in every stage and under either spelling.
 *
 * Every stage, because `ARG` scope is per stage and which stage runs the build is not a fact this text
 * can establish. Reading the file as one namespace can only ACCEPT a declaration that sits in the wrong
 * stage; resolving stages by guessing which `RUN` is the build would REJECT correct files.
 * @param dockerfile the Dockerfile body.
 * @returns each name once, sorted.
 */
export const declaredBuildArguments = (dockerfile: string): readonly string[] =>
  uniqueSorted(
    logicalLines(dockerfile).flatMap((line: string): readonly string[] => {
      const names: string | undefined = ARG_DECLARATION.exec(line)?.groups?.['names']
      return names === undefined ? [] : argumentNamesIn(names)
    }),
  )

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

const ROOT_MEMBER: string = '.'

// The member a path belongs to: the deepest one whose directory contains it, the same rule a working
// directory is resolved by, so a nested member keeps its own image instead of inheriting its parent's.
const ownerOf = (file: string, everyMemberPath: readonly string[]): string =>
  [...everyMemberPath]
    .filter(
      (candidate: string): boolean => candidate !== ROOT_MEMBER && file.startsWith(`${candidate}/`),
    )
    .toSorted((left: string, right: string): number => right.length - left.length)
    .at(0) ?? ROOT_MEMBER

/**
 * The Dockerfiles that build one member: those inside its own directory, and - for the member at the
 * repository root - those no other member owns.
 * @param memberPath the member's repo-relative path, `.` at the repository root.
 * @param everyMemberPath every governed member's path.
 * @param dockerfiles every Dockerfile the repository tracks.
 * @returns the Dockerfiles that build this member, in the order given.
 */
export const dockerfilesBuilding = (
  memberPath: string,
  everyMemberPath: readonly string[],
  dockerfiles: readonly DockerfileSource[],
): readonly DockerfileSource[] =>
  dockerfiles.filter(
    (dockerfile: DockerfileSource): boolean =>
      ownerOf(dockerfile.file, everyMemberPath) === memberPath,
  )

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

const missingBuildArguments = (build: ImageBuild): readonly EnvironmentViolation[] => {
  // A member that ships no image owes no build argument. One-directional, like every rule above.
  if (build.dockerfiles.length === 0) {
    return []
  }
  const declared: ReadonlySet<string> = new Set(
    build.dockerfiles.flatMap((dockerfile: DockerfileSource): readonly string[] =>
      declaredBuildArguments(dockerfile.content),
    ),
  )
  const files: string = build.dockerfiles
    .map((dockerfile: DockerfileSource): string => dockerfile.file)
    .join(', ')
  return uniqueSorted(
    build.sources.flatMap((source: string): readonly string[] => inlinedEnvironmentNames(source)),
  )
    .filter((name: string): boolean => !declared.has(name))
    .map(
      (name: string): EnvironmentViolation => ({
        name,
        origin: 'dockerfile',
        reason: [
          `inlined into the image at build time but declared by no ARG in ${files},`,
          'so docker discards the --build-arg that supplies it and warns rather than failing:',
          `add "ARG ${name}" to the stage that runs the build`,
        ].join(' '),
      }),
    )
}

/**
 * Every environment variable declared in one place and absent from another it has to reach.
 *
 * Four containments, each one-directional. What the application reads must be documented. What a
 * compose file interpolates must be documented, because `docker compose config` reads the example file
 * a developer copied. What a compose file interpolates must be supplied by every workflow that
 * verifies, because a workflow has no copied file to interpolate from. And what a build inlines must be
 * declared as an `ARG`, because docker discards a `--build-arg` the Dockerfile never named and warns
 * rather than failing - so the value is absent from the image and nothing says so.
 *
 * The inlined names feed the Dockerfile containment ALONE. Joining them to the example-file rule would
 * report a member that documents its public variables in its own example file rather than the
 * repository's, which is where they belong and where this reader does not look.
 * @param inputs the files, already read.
 * @returns the violations, sorted by name within each rule. An empty array means the five places agree.
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
    ...inputs.builds.flatMap((build: ImageBuild): readonly EnvironmentViolation[] =>
      missingBuildArguments(build),
    ),
  ]
}
