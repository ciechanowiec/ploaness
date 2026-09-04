// Where a repository names the container images it pulls, read into plain references.
//
// Three files name an image: a Dockerfile in its `FROM` lines, a workflow in the `image:` of a service
// or job container and in a `docker://` action, and a compose file in `services.*.image`. The compose
// half is read from the model `docker compose config --format json` renders rather than from the YAML,
// because compose interpolates `${VARIABLE}` from the `.env` beside the file and resolves the override
// files it merges, and a reader of the source text would judge a reference the daemon never pulls.
//
// The Dockerfile and workflow readers are line readers over a known syntax, in the spirit of
// `yaml-blocks.ts`: what has to be recognised is one keyword and the token after it.

import { asRecord, asText, isArray, isRecord, parseJsonc } from './json-shapes.js'
import { withoutQuotes } from './yaml-blocks.js'

const CONTINUATION: RegExp = /\\\r?\n/g
// A keyword, horizontal space, then a value that starts with a non-space: the value pattern cannot
// exchange characters with the space run before it, which is what keeps the match linear.
const FROM_LINE: RegExp = /^[ \t]*FROM[ \t]+(?<rest>\S.*)$/i
const ARG_LINE: RegExp = /^[ \t]*ARG[ \t]+(?<name>[A-Z_]\w*)=(?<value>\S+)/i
const RUN_LINE: RegExp = /^[ \t]*RUN[ \t]+(?<rest>\S.*)$/i
const COMMENT_LINE: RegExp = /^[ \t]*#/
// A base image every multi-stage build may start from that no registry serves.
const SCRATCH: string = 'scratch'
const STAGE_KEYWORD: string = 'as'
const PLATFORM_OPTION: string = '--'

// The install verbs of the package managers a base image ships. `apt-get install`, `apk add`, and the
// Red Hat family; pip and npm are language installs and judged elsewhere.
const INSTALL_VERB: RegExp = /\b(?:apt-get|apt|apk|dnf|microdnf|yum|zypper)[ \t]+(?:install|add)\b/
const COMMAND_SEPARATOR: RegExp = /&&|\|\||;|\|/
// What ends a package name in an install token: apt's `=version` and `/suite`, apk's `=version` and
// `~version`. dnf's `-version` is indistinguishable from a hyphenated name and is left alone.
const PACKAGE_NAME_END: RegExp = /[=/~]/
const OPTION_PREFIX: string = '-'

const WORKFLOW_IMAGE: RegExp = /^[ \t]*(?:-[ \t]*)?image:[ \t]*(?<value>[^\s#][^#]*)/
const WORKFLOW_CONTAINER: RegExp = /^[ \t]*container:[ \t]*(?<value>[^\s#{]+)/
const WORKFLOW_DOCKER_ACTION: RegExp = /uses:[ \t]*['"]?docker:\/\/(?<value>[^\s'"]+)/

/**
 * Join backslash-continued lines, so a `RUN` split across lines reads as the one command it is.
 * @param text the file body.
 * @returns one entry per logical line.
 */
export const logicalLines = (text: string): readonly string[] =>
  text.replaceAll(CONTINUATION, ' ').split('\n')

const contentLines = (text: string): readonly string[] =>
  logicalLines(text).filter((line: string): boolean => !COMMENT_LINE.test(line))

interface FromClause {
  readonly reference: string
  readonly stage: string | undefined
}

const readFrom = (rest: string | undefined): FromClause | undefined => {
  const tokens: readonly string[] = (rest ?? '')
    .trim()
    .split(/[ \t]+/)
    .filter((token: string): boolean => !token.startsWith(PLATFORM_OPTION))
  const [first, keyword, stage]: readonly (string | undefined)[] = tokens
  const reference: string = first ?? ''
  if (reference.length === 0) {
    return undefined
  }
  return { reference, stage: keyword?.toLowerCase() === STAGE_KEYWORD ? stage : undefined }
}

// `FROM node:${NODE_VERSION}` is the common way to state a version once, and the ARG that gives it a
// default is the only place the value lives. Both spellings of a reference are substituted; an ARG with
// no default leaves the variable in place, and the rule reports it as a reference it cannot judge.
const substituteArguments = (reference: string, defaults: ReadonlyMap<string, string>): string =>
  [...defaults].reduce(
    (resolved: string, [name, value]: readonly [string, string]): string =>
      resolved
        .replaceAll(`\${${name}}`, (): string => value)
        .replaceAll(`$${name}`, (): string => value),
    reference,
  )

interface DockerfileWalk {
  readonly defaults: ReadonlyMap<string, string>
  readonly stages: ReadonlySet<string>
  readonly references: readonly string[]
}

const recordArgument = (walk: DockerfileWalk, line: string): DockerfileWalk | undefined => {
  const found: RegExpExecArray | null = ARG_LINE.exec(line)
  if (found?.groups === undefined) {
    return undefined
  }
  const defaults: ReadonlyMap<string, string> = new Map<string, string>([
    ...walk.defaults,
    [found.groups['name'] ?? '', withoutQuotes(found.groups['value'] ?? '')],
  ])
  return { ...walk, defaults }
}

const recordFrom = (walk: DockerfileWalk, line: string): DockerfileWalk => {
  const from: FromClause | undefined = readFrom(FROM_LINE.exec(line)?.groups?.['rest'])
  if (from === undefined) {
    return walk
  }
  const reference: string = substituteArguments(from.reference, walk.defaults)
  const isRegistryImage: boolean = reference !== SCRATCH && !walk.stages.has(reference)
  return {
    defaults: walk.defaults,
    stages: from.stage === undefined ? walk.stages : new Set<string>([...walk.stages, from.stage]),
    references: isRegistryImage ? [...walk.references, reference] : walk.references,
  }
}

/**
 * The images a Dockerfile pulls: every `FROM` that names a registry image rather than an earlier stage.
 * @param text the Dockerfile body.
 * @returns the references in file order, with `ARG` defaults substituted.
 */
export const imageReferencesInDockerfile = (text: string): readonly string[] =>
  contentLines(text).reduce(
    (walk: DockerfileWalk, line: string): DockerfileWalk =>
      recordArgument(walk, line) ?? recordFrom(walk, line),
    { defaults: new Map<string, string>(), stages: new Set<string>(), references: [] },
  ).references

const packagesInCommand = (command: string): readonly string[] => {
  const verb: RegExpExecArray | null = INSTALL_VERB.exec(command)
  if (verb === null) {
    return []
  }
  return command
    .slice(verb.index + verb[0].length)
    .trim()
    .split(/[ \t]+/)
    .filter((token: string): boolean => token.length > 0 && !token.startsWith(OPTION_PREFIX))
    .map((token: string): string => token.split(PACKAGE_NAME_END)[0] ?? '')
}

/**
 * The system packages a Dockerfile installs through the base image's package manager.
 * @param text the Dockerfile body.
 * @returns every package name after an install verb, in file order.
 */
export const systemPackagesInDockerfile = (text: string): readonly string[] =>
  contentLines(text).flatMap((line: string): readonly string[] => {
    const rest: string | undefined = RUN_LINE.exec(line)?.groups?.['rest']
    return rest === undefined
      ? []
      : rest
          .split(COMMAND_SEPARATOR)
          .flatMap((command: string): readonly string[] => packagesInCommand(command))
  })

const workflowReferenceIn = (line: string): string | undefined => {
  const found: RegExpExecArray | null =
    WORKFLOW_DOCKER_ACTION.exec(line) ?? WORKFLOW_IMAGE.exec(line) ?? WORKFLOW_CONTAINER.exec(line)
  const value: string | undefined = found?.groups?.['value']
  return value === undefined ? undefined : withoutQuotes(value.trim())
}

/**
 * The images a GitHub Actions workflow pulls: service containers, job containers, and Docker actions.
 * @param text the workflow body.
 * @returns the references in file order.
 */
export const imageReferencesInWorkflow = (text: string): readonly string[] =>
  text
    .split('\n')
    .filter((line: string): boolean => !COMMENT_LINE.test(line))
    .flatMap((line: string): readonly string[] => {
      const reference: string | undefined = workflowReferenceIn(line)
      return reference === undefined || reference.length === 0 ? [] : [reference]
    })

/** One service of a compose model and the image it pulls. */
export interface ComposeImage {
  readonly service: string
  readonly image: string
}

/**
 * The images a rendered compose model pulls. A service with a `build` is judged through its Dockerfile,
 * and its `image` is only the name the build is tagged with.
 * @param json the output of `docker compose config --format json`.
 * @returns the pulled images by service name, or undefined when the text is not a compose model.
 */
export const imageReferencesInComposeModel = (
  json: string,
): readonly ComposeImage[] | undefined => {
  const model: unknown = parseJsonc(json).value
  if (!isRecord(model) || isArray(model) || !isRecord(model['services'])) {
    return undefined
  }
  return Object.entries(model['services'])
    .flatMap(([service, definition]: readonly [string, unknown]): readonly ComposeImage[] => {
      const image: string = asText(asRecord(definition)['image'])
      const isBuilt: boolean = asRecord(definition)['build'] !== undefined
      return isBuilt || image.length === 0 ? [] : [{ service, image }]
    })
    .toSorted((one: ComposeImage, other: ComposeImage): number =>
      one.service.localeCompare(other.service),
    )
}

/**
 * Whether a reference still carries a variable nothing substituted, so no rule can say what it pulls.
 * @param reference the reference as read.
 * @returns true when a `$` remains in it.
 */
export const hasUnresolvedVariable = (reference: string): boolean => reference.includes('$')
