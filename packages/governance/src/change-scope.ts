// Which pages a change can affect, so `delta` verification sweeps those and nothing else.
//
// The change is everything that differs from the merge-base of HEAD with the default branch of the first
// remote: commits not on that branch, staged and unstaged edits, and untracked files alike. A changed
// file reaches pages through the import graph. A route is in scope when one of its entry modules - its
// page, and the layout, template, loading, error and not-found modules above it - imports the file,
// directly or not; a story is in scope when its story file does. Whatever the graph cannot follow is
// global, and a global change sweeps everything. Nothing is remembered between runs: the scope is
// derived from Git each time, and it is safe only because `full` sweeps the default branch completely.
import path from 'node:path'
import { BROWSER_ENDPOINT_ENVIRONMENT_VARIABLE } from './browser-run.js'
import { isWithinSourceRoots, STYLESHEET_EXTENSIONS } from './file-roles.js'
import { isArray, isRecord } from './json-shapes.js'
import { appRootOf, type DeclaredRoute, declaredRoutesOf, isRootLayout, resolvedRouteOf } from './route-map.js'

/** Names the file that holds the change scope a `delta` run hands its browser sweep. */
export const SWEEP_SCOPE_ENVIRONMENT_VARIABLE: string = 'PLOANESS_SWEEP_SCOPE'

/**
 * Whether the browser sweep runs its engine pass in Firefox and WebKit as well as in Chromium. Only an
 * unscoped run with the pinned browsers does: a `delta` run sweeps the change in Chromium alone.
 * @param environment the runner's environment.
 * @returns true when the other engines run.
 */
export const coversEveryEngine = (environment: Readonly<Record<string, string | undefined>>): boolean =>
  environment[BROWSER_ENDPOINT_ENVIRONMENT_VARIABLE] !== undefined &&
  environment[SWEEP_SCOPE_ENVIRONMENT_VARIABLE] === undefined

/** The default branch a remote names when its own `HEAD` is not recorded. */
const DEFAULT_BRANCH: string = 'main'

/** The remote a clone names first, and the one the baseline is read from when it exists. */
const PREFERRED_REMOTE: string = 'origin'

/**
 * The remote whose default branch is the baseline: `origin` when there is one, otherwise the first.
 * @param remotes the repository's remotes, as `git remote` lists them.
 * @returns the remote, or undefined when the repository has none.
 */
export const baselineRemote = (remotes: readonly string[]): string | undefined =>
  remotes.includes(PREFERRED_REMOTE) ? PREFERRED_REMOTE : remotes[0]

const REMOTES_PREFIX: string = 'refs/remotes/'

/**
 * The remote-tracking branch that stands for the remote's default branch.
 * @param remote the remote.
 * @param symbolicHead what `refs/remotes/<remote>/HEAD` points at, or undefined when it is not recorded.
 * @returns a ref such as `origin/main`.
 */
export const trackingBranch = (remote: string, symbolicHead: string | undefined): string =>
  symbolicHead?.startsWith(`${REMOTES_PREFIX}${remote}/`) === true
    ? symbolicHead.slice(REMOTES_PREFIX.length)
    : `${remote}/${DEFAULT_BRANCH}`

/** What Git said about the baseline. */
export interface BaselineFacts {
  /** The remote-tracking default branch, or undefined when the repository has none. */
  readonly branch: string | undefined
  readonly isShallow: boolean
  /** The merge-base of HEAD with the branch, or undefined when there is none. */
  readonly mergeBase: string | undefined
}

/** The commit a change is measured from, or why there is none. */
export type Baseline =
  | { readonly commit: string; readonly branch: string }
  | { readonly commit: undefined; readonly problem: string }

/**
 * Decide the commit a change is measured from. Local `main` is never it: a commit made on it would be
 * its own baseline and never be checked. A shallow clone may lack the true merge-base, so it has none.
 * @param facts what Git said.
 * @returns the merge-base, or why the sweep has to be complete.
 */
export const changeBaseline = (facts: BaselineFacts): Baseline => {
  if (facts.branch === undefined) {
    return {
      commit: undefined,
      problem: `the repository has no remote-tracking default branch, such as ${PREFERRED_REMOTE}/${DEFAULT_BRANCH}`,
    }
  }
  if (facts.isShallow) {
    return { commit: undefined, problem: `the clone is shallow, so its merge-base with ${facts.branch} is unknown` }
  }
  return facts.mergeBase === undefined
    ? { commit: undefined, problem: `HEAD and ${facts.branch} share no merge-base` }
    : { commit: facts.mergeBase, branch: facts.branch }
}

/** A file that differs from the baseline, relative to the repository root. */
export interface ChangedFile {
  readonly path: string
  readonly isDeleted: boolean
}

/** A route pattern or story file in scope, and why. */
export interface ScopedTarget {
  readonly target: string
  readonly reason: string
}

/** What a `delta` run hands its sweep: the change, and either everything or what the change reaches. */
export type SweepScope =
  | {
      readonly isComplete: true
      readonly baseline: string | undefined
      readonly branch: string | undefined
      readonly changed: readonly string[]
      /** Why the sweep covers everything. */
      readonly reasons: readonly string[]
    }
  | {
      readonly isComplete: false
      readonly baseline: string
      readonly branch: string
      readonly changed: readonly string[]
      /** Declared route patterns, as `declaredRoutesOf` spells them. */
      readonly routes: readonly ScopedTarget[]
      /** Story files, relative to the application's root. */
      readonly stories: readonly ScopedTarget[]
    }

/** Everything deciding one application's scope needs. */
export interface ScopeInputs {
  readonly baseline: Baseline
  readonly changed: readonly ChangedFile[]
  /** The application's path in the repository, `.` at the root. */
  readonly member: string
  readonly sourceRoots: readonly string[]
  /** Every governed member's path. */
  readonly members: readonly string[]
  /**
   * The members whose change reaches this application without an import: those it starts as auxiliary
   * servers, such as a CMS it renders from, and those it depends on as packages.
   */
  readonly related: readonly string[]
  /** The application's files, relative to its root. */
  readonly files: readonly string[]
  /** The application's import graph: each module, relative to its root, and the modules it imports. */
  readonly graph: Readonly<Record<string, readonly string[]>>
}

// Repository files that decide what is installed and how it runs, for every member alike.
const REPOSITORY_INPUTS: ReadonlySet<string> = new Set<string>([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  '.nvmrc',
])

/** A member file every page depends on without importing it. */
interface GlobalInput {
  readonly pattern: RegExp
  readonly what: string
}

// Relative to the member root. A theme or token file needs no entry: a Tailwind theme is a global
// stylesheet, a token module is followed through the graph, and anything else under a source root is
// unknown and therefore global.
const MEMBER_INPUTS: readonly GlobalInput[] = [
  { pattern: /^package\.json$/u, what: 'the manifest' },
  { pattern: /^tsconfig\.json$/u, what: 'the TypeScript configuration, which decides how imports resolve' },
  { pattern: /^next\.config\.[cm]?[jt]s$/u, what: 'the Next.js configuration' },
  { pattern: /^(?:tailwind|postcss)\.config\.[cm]?[jt]s$/u, what: 'the style tool configuration' },
  {
    pattern: /^(?:src\/)?(?:middleware|proxy|instrumentation(?:-client)?)\.[cm]?[jt]sx?$/u,
    what: 'request handling every route passes through',
  },
  { pattern: /^(?:\.env[^/]*|[^/]+\.env)$/u, what: 'an environment file' },
  { pattern: /^public\//u, what: 'a public file pages may load' },
  { pattern: /(?:^|\/)\.storybook\//u, what: 'the Storybook configuration' },
]

const CSS_MODULE: RegExp = /\.module\.[a-z]+$/u

const isGlobalStylesheet = (file: string): boolean =>
  STYLESHEET_EXTENSIONS.some((extension: string): boolean => file.endsWith(extension)) && !CSS_MODULE.test(file)

const ROOT_MEMBER: string = '.'

const isInside = (file: string, member: string): boolean =>
  member === ROOT_MEMBER || file === member || file.startsWith(`${member}/`)

// The deepest member holding the file: a nested member's files are its own, not its parent's.
const ownerOf = (file: string, members: readonly string[]): string | undefined =>
  members
    .filter((member: string): boolean => isInside(file, member))
    .reduce<string | undefined>(
      (deepest: string | undefined, member: string): string =>
        deepest === undefined || deepest === ROOT_MEMBER || member.length > deepest.length ? member : deepest,
      undefined,
    )

const relativeTo = (file: string, member: string): string =>
  member === ROOT_MEMBER ? file : file.slice(member.length + 1)

/** What one changed file means for an application's pages. */
type Effect =
  | { readonly kind: 'global'; readonly reason: string }
  | { readonly kind: 'graph'; readonly file: string }
  | { readonly kind: 'none' }

const NO_EFFECT: Effect = { kind: 'none' }

const globalEffect = (reason: string): Effect => ({ kind: 'global', reason })

// What makes a member file global, or undefined when nothing does.
const memberInputKind = (file: string, appRoot: string | undefined): string | undefined => {
  const input: GlobalInput | undefined = MEMBER_INPUTS.find((candidate: GlobalInput): boolean =>
    candidate.pattern.test(file),
  )
  if (input !== undefined) {
    return input.what
  }
  if (isGlobalStylesheet(file)) {
    return 'a global stylesheet'
  }
  return appRoot !== undefined && isRootLayout(file, appRoot) ? 'the root layout' : undefined
}

// A file of this application: global, followed through the graph, or outside what pages are built from.
// A deleted module is in no graph, and it reaches nothing on its own: a module still importing it no
// longer builds, and one that stopped importing it is itself changed.
const ownEffect = (changed: ChangedFile, inputs: ScopeInputs, appRoot: string | undefined): Effect => {
  const file: string = relativeTo(changed.path, inputs.member)
  const kind: string | undefined = memberInputKind(file, appRoot)
  if (kind !== undefined) {
    return globalEffect(`${changed.path} is ${kind}`)
  }
  if (!isWithinSourceRoots(file, inputs.sourceRoots)) {
    return NO_EFFECT
  }
  if (inputs.graph[file] !== undefined) {
    return { kind: 'graph', file }
  }
  return changed.isDeleted
    ? NO_EFFECT
    : globalEffect(`${changed.path} is not in the import graph, so what it reaches is unknown`)
}

const effectOf = (changed: ChangedFile, inputs: ScopeInputs, appRoot: string | undefined): Effect => {
  if (REPOSITORY_INPUTS.has(changed.path)) {
    return globalEffect(`${changed.path} decides what is installed for every member`)
  }
  const owner: string | undefined = ownerOf(changed.path, inputs.members)
  if (owner === inputs.member) {
    return ownEffect(changed, inputs, appRoot)
  }
  return owner !== undefined && inputs.related.includes(owner)
    ? globalEffect(`${changed.path} belongs to ${owner}, which this application runs beside or depends on`)
    : NO_EFFECT
}

/** One import: the importing module and the module imported. */
interface Edge {
  readonly from: string
  readonly to: string
}

const edgesOf = (graph: Readonly<Record<string, readonly string[]>>): readonly Edge[] =>
  Object.entries(graph).flatMap(([from, imports]: readonly [string, readonly string[]]): readonly Edge[] =>
    imports.map((to: string): Edge => ({ from, to })),
  )

// Every module that imports one of the frontier's, directly or not, added to what is already reached.
const reachedFrom = (
  frontier: ReadonlySet<string>,
  reached: ReadonlySet<string>,
  edges: readonly Edge[],
): ReadonlySet<string> => {
  const next: ReadonlySet<string> = new Set<string>(
    edges
      .filter((edge: Edge): boolean => frontier.has(edge.to) && !reached.has(edge.from))
      .map((edge: Edge): string => edge.from),
  )
  return next.size === 0 ? reached : reachedFrom(next, new Set<string>([...reached, ...next]), edges)
}

/** A changed module, and every module that imports it. */
interface Reach {
  readonly changed: string
  readonly importers: ReadonlySet<string>
}

const SEGMENT_MODULE: RegExp = /^(?:layout|template|loading|error|not-found)\.(?:tsx|ts|jsx|js)$/u

// The page, and every segment module in its directory or above it inside the app directory.
const entryModules = (page: string, appRoot: string, files: readonly string[]): readonly string[] => {
  const directory: string = path.posix.dirname(page)
  const isAbove = (candidate: string): boolean => {
    const own: string = path.posix.dirname(candidate)
    return (own === directory || directory.startsWith(`${own}/`)) && isInside(own, appRoot)
  }
  return [
    page,
    ...files.filter(
      (file: string): boolean => SEGMENT_MODULE.test(path.posix.basename(file)) && isAbove(file) && file !== page,
    ),
  ]
}

const reasonFor = (entries: readonly string[], reaches: readonly Reach[]): string | undefined => {
  const hits: readonly (readonly [string, Reach])[] = entries.flatMap(
    (entry: string): readonly (readonly [string, Reach])[] =>
      reaches.filter((reach: Reach): boolean => reach.importers.has(entry)).map((reach: Reach) => [entry, reach]),
  )
  const [first] = hits
  if (first === undefined) {
    return undefined
  }
  const [entry, reach] = first
  const others: number = new Set<string>(hits.map(([, hit]: readonly [string, Reach]): string => hit.changed)).size - 1
  const subject: string = entry === reach.changed ? `${entry} changed` : `${entry} reaches ${reach.changed}`
  return others === 0 ? subject : `${subject} and ${String(others)} more changed file(s)`
}

const STORY_FILE: RegExp = /\.stories\.[cm]?[jt]sx?$/u

const routeTargets = (
  inputs: ScopeInputs,
  appRoot: string | undefined,
  reaches: readonly Reach[],
): readonly ScopedTarget[] =>
  appRoot === undefined
    ? []
    : declaredRoutesOf(inputs.files, appRoot).flatMap((route: DeclaredRoute): readonly ScopedTarget[] => {
        const reason: string | undefined = reasonFor(entryModules(route.file, appRoot, inputs.files), reaches)
        return reason === undefined ? [] : [{ target: route.route, reason }]
      })

const storyTargets = (inputs: ScopeInputs, reaches: readonly Reach[]): readonly ScopedTarget[] =>
  Object.keys(inputs.graph)
    .filter((module: string): boolean => STORY_FILE.test(module))
    .flatMap((story: string): readonly ScopedTarget[] => {
      const reason: string | undefined = reasonFor([story], reaches)
      return reason === undefined ? [] : [{ target: story, reason }]
    })

/**
 * Decide what one application's browser sweep covers for a change.
 *
 * Everything, when there is no baseline, or when a changed file is a global input: a dependency or
 * toolchain file, the application's manifest, TypeScript, Next.js, Tailwind or PostCSS configuration,
 * request handling, an environment file, a public file, the Storybook configuration, a global
 * stylesheet, the root layout, a file under a source root the import graph does not hold, or any file
 * of a member the application runs beside or depends on. Otherwise the routes and stories whose entry
 * modules reach a changed module. A file outside every source root, such as documentation or a
 * workflow, and a file of an unrelated member, change no page.
 * @param inputs the baseline, the change, and the application's members, files and graph.
 * @returns the scope, with a reason for each route and story or for covering everything.
 */
export const sweepScopeOf = (inputs: ScopeInputs): SweepScope => {
  const changed: readonly string[] = inputs.changed.map((file: ChangedFile): string => file.path)
  if (inputs.baseline.commit === undefined) {
    return { isComplete: true, baseline: undefined, branch: undefined, changed, reasons: [inputs.baseline.problem] }
  }
  const appRoot: string | undefined = appRootOf(inputs.files)
  const effects: readonly Effect[] = inputs.changed.map((file: ChangedFile): Effect => effectOf(file, inputs, appRoot))
  const reasons: readonly string[] = effects.flatMap((effect: Effect): readonly string[] =>
    effect.kind === 'global' ? [effect.reason] : [],
  )
  if (reasons.length > 0) {
    return { isComplete: true, baseline: inputs.baseline.commit, branch: inputs.baseline.branch, changed, reasons }
  }
  const edges: readonly Edge[] = edgesOf(inputs.graph)
  const reaches: readonly Reach[] = effects.flatMap((effect: Effect): readonly Reach[] => {
    if (effect.kind !== 'graph') {
      return []
    }
    const start: ReadonlySet<string> = new Set<string>([effect.file])
    return [{ changed: effect.file, importers: reachedFrom(start, start, edges) }]
  })
  return {
    isComplete: false,
    baseline: inputs.baseline.commit,
    branch: inputs.baseline.branch,
    changed,
    routes: routeTargets(inputs, appRoot, reaches),
    stories: storyTargets(inputs, reaches),
  }
}

const isTargets = (value: unknown): boolean =>
  isArray(value) &&
  value.every(
    (entry: unknown): boolean =>
      isRecord(entry) && typeof entry['target'] === 'string' && typeof entry['reason'] === 'string',
  )

const isStrings = (value: unknown): boolean =>
  isArray(value) && value.every((entry: unknown): boolean => typeof entry === 'string')

/**
 * Whether a parsed value is a scope as `sweepScopeOf` produces it.
 * @param value the parsed value.
 * @returns whether it carries every field its kind has.
 */
export const isSweepScope = (value: unknown): value is SweepScope => {
  if (!(isRecord(value) && isStrings(value['changed']))) {
    return false
  }
  return value['isComplete'] === true
    ? isStrings(value['reasons'])
    : value['isComplete'] === false &&
        typeof value['baseline'] === 'string' &&
        typeof value['branch'] === 'string' &&
        isTargets(value['routes']) &&
        isTargets(value['stories'])
}

const SHORT_COMMIT: number = 12

const sinceText = (baseline: string | undefined, branch: string | undefined): string =>
  baseline === undefined || branch === undefined
    ? ''
    : ` since ${baseline.slice(0, SHORT_COMMIT)}, the merge-base of HEAD and ${branch}`

/**
 * One line naming the level and what it covers.
 * @param scope the scope.
 * @returns the line.
 */
export const scopeHeadline = (scope: SweepScope): string =>
  scope.isComplete
    ? `delta${sinceText(scope.baseline, scope.branch)}, complete because ${scope.reasons.join('; ')}`
    : `delta${sinceText(scope.baseline, scope.branch)}: ${String(scope.changed.length)} changed file(s) reach ` +
      `${String(scope.routes.length)} route(s) and ${String(scope.stories.length)} story file(s)`

const IN_COMPLETE_SCOPE: string = 'the sweep is complete'

/**
 * Why the sweep scans a crawled route, or undefined when the change cannot reach it. A route no
 * declaration renders is scanned, because what reaches it is unknown.
 * @param scope the scope.
 * @param declared every route the application's file tree declares.
 * @param route the crawled address.
 * @returns the reason, or undefined.
 */
export const routeReason = (
  scope: SweepScope,
  declared: readonly DeclaredRoute[],
  route: string,
): string | undefined => {
  if (scope.isComplete) {
    return IN_COMPLETE_SCOPE
  }
  const resolved: DeclaredRoute | undefined = resolvedRouteOf(declared, route)
  return resolved === undefined
    ? 'no route file declares it, so what reaches it is unknown'
    : scope.routes.find((target: ScopedTarget): boolean => target.target === resolved.route)?.reason
}

/**
 * The file a story is declared in, relative to the application's root.
 * @param importPath the story's `importPath`, relative to the Storybook's own directory.
 * @param directory that directory, relative to the application's root; `.` when it is the same.
 * @returns the file.
 */
export const storyFileOf = (importPath: string, directory: string): string =>
  path.posix.normalize(path.posix.join(directory, importPath))

/**
 * Why the sweep scans a story, or undefined when the change cannot reach it. A story declared outside
 * the application, or in no file Storybook names, is scanned, because what reaches it is unknown.
 * @param scope the scope.
 * @param storyFile the story's file, from `storyFileOf`, or empty when Storybook names none.
 * @returns the reason, or undefined.
 */
export const storyReason = (scope: SweepScope, storyFile: string): string | undefined => {
  if (scope.isComplete) {
    return IN_COMPLETE_SCOPE
  }
  if (storyFile === '' || storyFile === '..' || storyFile.startsWith('../')) {
    return 'its file is outside this application, so what reaches it is unknown'
  }
  return scope.stories.find((target: ScopedTarget): boolean => target.target === storyFile)?.reason
}

/** One module of dependency-cruiser's JSON report, reduced to what the graph needs. */
interface CruisedModule {
  readonly source: string
  readonly dependencies: readonly unknown[]
}

const isCruisedModule = (value: unknown): value is CruisedModule =>
  isRecord(value) && typeof value['source'] === 'string' && isArray(value['dependencies'])

/**
 * The import graph in dependency-cruiser's JSON report, the analyzer the architecture gate runs.
 * @param report the parsed report.
 * @returns each module, relative to where the analyzer ran, and the modules it imports; or undefined
 *   when the value is not such a report.
 */
export const importGraphOf = (report: unknown): Readonly<Record<string, readonly string[]>> | undefined => {
  const modules: unknown = isRecord(report) ? report['modules'] : undefined
  if (!(isArray(modules) && modules.every((module: unknown): boolean => isCruisedModule(module)))) {
    return undefined
  }
  return Object.fromEntries(
    modules
      .filter((module: unknown): module is CruisedModule => isCruisedModule(module))
      .map((module: CruisedModule): readonly [string, readonly string[]] => [
        module.source,
        module.dependencies.flatMap((dependency: unknown): readonly string[] => {
          const resolved: unknown = isRecord(dependency) ? dependency['resolved'] : undefined
          return typeof resolved === 'string' ? [resolved] : []
        }),
      ]),
  )
}

/**
 * The scope as a reader sees it: the level and baseline, every changed file, and each route and story
 * with the reason it is swept.
 * @param scope the scope.
 * @returns one line each, indented below the headline.
 */
export const scopeLines = (scope: SweepScope): readonly string[] => [
  scopeHeadline(scope),
  ...scope.changed.map((file: string): string => `  changed ${file}`),
  ...(scope.isComplete
    ? []
    : [
        ...scope.routes.map((target: ScopedTarget): string => `  route ${target.target}: ${target.reason}`),
        ...scope.stories.map((target: ScopedTarget): string => `  story ${target.target}: ${target.reason}`),
      ]),
]
