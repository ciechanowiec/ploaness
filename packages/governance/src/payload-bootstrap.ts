// Writes a boot hook performs, or reaches in one call.
//
// `onInit` runs on every boot of every container: a restart, a new replica and a redeploy each run it.
// A write there is not a seed but a schedule, and what it schedules is overwriting whatever an editor
// last saved. Repairing what is MISSING at boot is legitimate; holding an opinion about content is not.
//
// The rule follows one call out of the hook, because that is where the defect lives. A configuration
// hands the work to an imported function which performs the writes in its own body, so a same-file rule
// would read the hook, find no Local API call in it, and report nothing at all. Each further hop
// multiplies both the resolution machinery and the false-positive surface with no evidence that it is
// needed, so the depth stops at the one that reaches the defect.
import type { SpecSource } from './axe-coverage.js'
import { type FoundRootConfig, rootConfigsIn } from './payload-database.js'
import { LOCAL_API_CALLS, PAYLOAD_RECEIVER } from './payload-policy.js'
import { depthOneValue, type PayloadViolation } from './payload-source.js'
import type { LocatedViolation } from './relationship-cleanup.js'
import { balancedArguments, NOT_FOUND, occurrences, stripComments } from './source-text.js'

/** The operations that change stored state, named as the catalogue spells them. */
const MUTATION_NAMES: ReadonlySet<string> = new Set([
  'create',
  'delete',
  'restoreGlobalVersion',
  'restoreVersion',
  'update',
  'updateGlobal',
])

/**
 * The Local API operations that change stored state.
 *
 * Derived from the one catalogue rather than written out again: a second list is a second thing to keep
 * in step, and the two would disagree the first time Payload gained an operation. A read at boot is
 * legitimate and deliberately absent from this set.
 */
export const LOCAL_API_MUTATIONS: readonly string[] = LOCAL_API_CALLS.filter(
  (call: string): boolean => MUTATION_NAMES.has(call.slice(1, -1)),
)

/** The body of a configuration's boot hook, and the line its configuration begins on. */
export interface BootstrapHook {
  readonly body: string
  readonly line: number
}

const ARROW: string = '=>'

// The body a hook value opens, found after the arrow rather than at the first brace: a hook written
// `async ({ payload }) => { ... }` destructures before it opens, and the first brace is that pattern.
const hookBodyIn = (value: string): string | undefined => {
  const arrow: number = value.indexOf(ARROW)
  const from: number = arrow === NOT_FOUND ? 0 : arrow + ARROW.length
  const open: number = value.indexOf('{', from)
  return open === NOT_FOUND ? undefined : balancedArguments(value, open)
}

/**
 * The boot hook every root configuration in a source declares.
 * @param code the file's text, with comments already stripped.
 * @returns one entry per configuration that declares `onInit` with a body.
 */
export const bootstrapHooksIn = (code: string): readonly BootstrapHook[] =>
  rootConfigsIn(code).flatMap((config: FoundRootConfig): readonly BootstrapHook[] => {
    const value: string | undefined = depthOneValue(config.body, 'onInit')
    const body: string | undefined = value === undefined ? undefined : hookBodyIn(value)
    return body === undefined ? [] : [{ body, line: config.line }]
  })

// A Local API mutation performed on a Payload receiver, anywhere in a body.
//
// Distinct operations, not occurrences: a seed that writes two globals performs `updateGlobal` twice,
// and reporting it twice would print the same sentence twice for one repair. What the reader has to act
// on is that the body writes at all.
const mutationsIn = (body: string): readonly string[] => [
  ...new Set(
    LOCAL_API_MUTATIONS.flatMap((call: string): readonly string[] =>
      occurrences(body, call)
        .filter((found: number): boolean => PAYLOAD_RECEIVER.test(body.slice(0, found)))
        .map((): string => call.slice(1, -1)),
    ),
  ),
]

// The names a body calls. The keywords are removed because `if (` and `while (` are indistinguishable
// from a call by this pattern, and a keyword can never name an import.
const CALLED_IDENTIFIER: RegExp = /\b([a-z_$][\w$]*)\s*\(/gi
const STATEMENT_KEYWORDS: ReadonlySet<string> = new Set([
  'await',
  'catch',
  'for',
  'function',
  'if',
  'return',
  'switch',
  'typeof',
  'while',
])

const calledNamesIn = (body: string): readonly string[] => [
  ...new Set(
    [...body.matchAll(CALLED_IDENTIFIER)]
      .map((match: RegExpExecArray): string => match[1] ?? '')
      .filter((name: string): boolean => !STATEMENT_KEYWORDS.has(name)),
  ),
]

// Every quantifier here is bounded by a literal that cannot itself match, so the scan is linear: a
// binding clause runs to the one brace that closes it, and a specifier to the one quote that ends it.
const IMPORT_BINDING: RegExp = /\bimport\s+\{([^}]+)\}\s+from\s*['"]([^'"]+)['"]/g

const boundNames = (clause: string): readonly string[] =>
  clause
    .split(',')
    .map((binding: string): string => binding.trim().split(/\s+/).at(-1) ?? '')
    .filter((name: string): boolean => name.length > 0)

/**
 * The module specifier a name is imported from.
 * @param code the importing file's text.
 * @param name the imported binding to find.
 * @returns the specifier, or undefined when the file imports no such name.
 */
export const moduleOfImport = (code: string, name: string): string | undefined =>
  [...code.matchAll(IMPORT_BINDING)]
    .filter((match: RegExpExecArray): boolean => boundNames(match[1] ?? '').includes(name))
    .map((match: RegExpExecArray): string | undefined => match[2])
    .at(0)

const SOURCE_EXTENSIONS: readonly string[] = ['.ts', '.tsx']
const ALIAS: string = '@/'
const ALIAS_ROOT: string = 'src/'

const directoryOf = (filePath: string): string => {
  const slash: number = filePath.lastIndexOf('/')
  return slash === NOT_FOUND ? '' : filePath.slice(0, slash)
}

// `.` and `..` resolved without node:path, which keeps this layer free of every runtime module.
const flattened = (segments: readonly string[]): readonly string[] =>
  segments.reduce<readonly string[]>(
    (kept: readonly string[], segment: string): readonly string[] => {
      if (segment === '' || segment === '.') {
        return kept
      }
      return segment === '..' ? kept.slice(0, -1) : [...kept, segment]
    },
    [],
  )

// The path a specifier names before an extension is tried. A package specifier resolves to nothing,
// which is what keeps the rule inside the member's own source.
const resolvedBase = (specifier: string, fromPath: string): string | undefined => {
  if (specifier.startsWith(ALIAS)) {
    return `${ALIAS_ROOT}${specifier.slice(ALIAS.length)}`
  }
  return specifier.startsWith('.')
    ? flattened([...directoryOf(fromPath).split('/'), ...specifier.split('/')]).join('/')
    : undefined
}

/**
 * The repository-relative paths a specifier could name, in the order a resolver would try them.
 * @param specifier the module specifier as written.
 * @param fromPath the member-relative path of the importing file.
 * @returns the candidate paths, empty when the specifier names a package rather than project source.
 */
export const candidatePathsFor = (specifier: string, fromPath: string): readonly string[] => {
  const base: string | undefined = resolvedBase(specifier, fromPath)
  return base === undefined
    ? []
    : [
        ...SOURCE_EXTENSIONS.map((extension: string): string => `${base}${extension}`),
        `${base}/index.ts`,
      ]
}

// The body of one named export, so a module holding an unrelated writer beside the function the hook
// actually calls is not reported for the writer it never reached.
const declarationOf = (name: string): RegExp =>
  new RegExp(String.raw`export\s+(?:async\s+)?(?:function\s+|const\s+)${name}\b`)

const bodyAfter = (source: string, at: number): string | undefined => {
  const open: number = source.indexOf('(', at)
  const parameters: string | undefined =
    open === NOT_FOUND ? undefined : balancedArguments(source, open)
  const from: number = parameters === undefined ? at : open + parameters.length + 1
  const brace: number = source.indexOf('{', from)
  return brace === NOT_FOUND ? undefined : balancedArguments(source, brace)
}

/**
 * The body of a named export.
 * @param source the module's text, with comments already stripped.
 * @param name the exported binding to read.
 * @returns the body, or undefined when the module exports no such binding with one.
 */
export const exportedBodyIn = (source: string, name: string): string | undefined => {
  const found: RegExpExecArray | null = declarationOf(name).exec(source)
  return found === null ? undefined : bodyAfter(source, found.index)
}

const RULE: string = 'no-boot-time-writes'
const REPAIR: string =
  'move the write behind a command the project runs deliberately, such as a seed script invoked by ' +
  'its own package script'

const directReason = (call: string): string =>
  `onInit: must not write through the Local API; ${call}() here runs on every boot of every ` +
  'container, so a restart, a new replica and a redeploy each overwrite whatever an editor last ' +
  `saved - ${REPAIR}`

const reachedReason = (name: string, specifier: string, call: string): string =>
  `onInit: must not reach a Local API write; it calls ${name}() from "${specifier}", which runs ` +
  `${call}() in its own body, so every boot of every container overwrites whatever an editor last ` +
  `saved - ${REPAIR}`

const sourceAt = (files: readonly SpecSource[], paths: readonly string[]): string | undefined =>
  files
    .filter((file: SpecSource): boolean => paths.includes(file.path))
    .map((file: SpecSource): string => stripComments(file.source))
    .at(0)

// One call out of the hook: the name has to be imported, the module has to be one of this member's own
// files, and the export it names has to perform the write itself.
const reachedWrites = (
  code: string,
  hook: BootstrapHook,
  file: SpecSource,
  files: readonly SpecSource[],
): readonly PayloadViolation[] =>
  calledNamesIn(hook.body).flatMap((name: string): readonly PayloadViolation[] => {
    const specifier: string | undefined = moduleOfImport(code, name)
    if (specifier === undefined) {
      return []
    }
    const target: string | undefined = sourceAt(files, candidatePathsFor(specifier, file.path))
    const body: string | undefined = target === undefined ? undefined : exportedBodyIn(target, name)
    return body === undefined
      ? []
      : mutationsIn(body).map(
          (call: string): PayloadViolation => ({
            line: hook.line,
            rule: RULE,
            reason: reachedReason(name, specifier, call),
          }),
        )
  })

/**
 * Report every Local API write a boot hook performs, or reaches in one call.
 *
 * Reported against the configuration that schedules the write rather than the module that performs it:
 * the module may be a legitimate seed, and what makes it a defect is being wired into `onInit`.
 * @param files every source file of the member, as read.
 * @returns one violation per write, located on the configuration that declares the hook.
 */
export const findBootstrapWrites = (files: readonly SpecSource[]): readonly LocatedViolation[] =>
  files.flatMap((file: SpecSource): readonly LocatedViolation[] => {
    const code: string = stripComments(file.source)
    return bootstrapHooksIn(code).flatMap((hook: BootstrapHook): readonly LocatedViolation[] =>
      [
        ...mutationsIn(hook.body).map(
          (call: string): PayloadViolation => ({
            line: hook.line,
            rule: RULE,
            reason: directReason(call),
          }),
        ),
        ...reachedWrites(code, hook, file, files),
      ].map((violation: PayloadViolation): LocatedViolation => ({ path: file.path, violation })),
    )
  })
