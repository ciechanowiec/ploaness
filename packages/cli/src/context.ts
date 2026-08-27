// Everything a gate needs to know about the project it is judging, resolved once per run.
import { execFileSync } from 'node:child_process'
import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import {
  asRecord,
  asStringRecord,
  type DeclaredExclusion,
  findGovernedMembers,
  findRepositoryRoot,
  isPayloadProject,
  type ParsedJson,
  type ProjectManifest,
  parseJsonc,
  ploanessBlock,
  ROOT_MEMBER_PATH,
  readKey,
  readMemberSettings,
  readSettings,
  readWorkspacePackages,
  rebaseExclusion,
  runEnvironmentFiles,
  runEnvironmentOverrides,
  type Settings,
  selectProjects,
} from '@ploaness/governance'

const nodeRequire: NodeJS.Require = createRequire(import.meta.url)
const BYTES_PER_KIB: number = 1024
const KIB_PER_MIB: number = 1024
// Large enough that no analyzer's output is truncated before it can be reported.
const MAX_OUTPUT_MIB: number = 64
const MAX_OUTPUT_BYTES: number = MAX_OUTPUT_MIB * KIB_PER_MIB * BYTES_PER_KIB

/** The resolved environment of one ploaness run. */
export interface Context {
  /** The consuming project's repository root. */
  readonly root: string
  /** The project's parsed package.json, or undefined when it has none. */
  readonly packageJson: unknown
  /** The effective settings the project declared. */
  readonly settings: Settings
  /** False in report-only mode, where findings print but the run still exits 0. */
  readonly isEnforced: boolean
}

/**
 * One governed package.
 *
 * `root` is the member's own directory, which is why every check that joins a path onto it kept working
 * unchanged when members arrived: for a single-package repository the member root IS the repository
 * root, so the field means exactly what it always meant.
 */
export interface Member extends Context {
  /** Repo-relative, `.` for the member at the repository root. */
  readonly path: string
  /** Whether this member declares Payload, which decides if the Payload-scope gates ask about it. */
  readonly isPayload: boolean
  /**
   * The other members' paths, relative to THIS member's directory.
   *
   * An analyzer that walks everything below where it runs has to be told where this package stops. At
   * a workspace root every sibling sits underneath, and without this each sibling's entry point is
   * reported as an unused file by a run that was never analysing it.
   */
  readonly siblingPaths: readonly string[]
}

/**
 * The repository a run judges, and every member inside it.
 *
 * The distinction this type exists to make is the one ploaness did not have: an install-script
 * allowlist, an overrides block and a managed dotfile are facts about the REPOSITORY, and reading them
 * from a member's directory produced a verdict about a file that was never there.
 */
export interface Repository extends Context {
  /** The workspace file at the repository root - the only place pnpm honours these keys. */
  readonly workspaceFile: string
  readonly members: readonly Member[]
  /** Every pnpm project the workspace selects, governed or not, for the anti-bypass rule. */
  readonly projects: readonly ProjectManifest[]
}

/**
 * Read a JSON file, returning undefined when it is absent or unparseable.
 *
 * Comments and trailing commas are tolerated, because the files this reads - a tsconfig, a Biome
 * config, a runtime settings file - legally carry them, and a reader that refused them would report the
 * project as malformed for writing what its own tools accept.
 * @param file the absolute path.
 * @returns the parsed value, or undefined.
 */
export const readJson = (file: string): unknown =>
  existsSync(file) ? parseJsonc(readFileSync(file, 'utf8')).value : undefined

/** Read a text file, returning undefined when it is absent. */
export const readText = (file: string): string | undefined =>
  existsSync(file) ? readFileSync(file, 'utf8') : undefined

/** Build the run context for a project root. */
export const createContext = (root: string, isEnforced: boolean): Context => {
  const packageJson: unknown = readJson(path.join(root, 'package.json'))
  return { root, packageJson, settings: readSettings(packageJson), isEnforced }
}

// Locating a tool is harder than it looks. A package may restrict its `exports` so `pkg/package.json` is
// not addressable (dependency-cruiser), and it may publish an `import` condition only, so CJS resolution
// of its entry point fails too. Three routes are tried in turn, and the last one is the one that always
// works: find the entry point through ESM resolution and walk up to the manifest beside it.
const manifestFrom = (directory: string): string => {
  const candidate: string = path.join(directory, 'package.json')
  if (existsSync(candidate)) {
    return candidate
  }
  const parent: string = path.dirname(directory)
  if (parent === directory) {
    throw new Error(`no package.json found above ${directory}`)
  }
  return manifestFrom(parent)
}

const manifestBeside = (entry: string): string => manifestFrom(path.dirname(entry))

const manifestOf = (packageName: string, resolveFrom: NodeJS.Require): string => {
  try {
    return resolveFrom.resolve(`${packageName}/package.json`)
  } catch {
    // fall through
  }
  try {
    return manifestBeside(resolveFrom.resolve(packageName))
  } catch {
    // fall through
  }
  try {
    return manifestBeside(fileURLToPath(import.meta.resolve(packageName)))
  } catch (error: unknown) {
    throw new Error(`ploaness could not locate the manifest of ${packageName}`, { cause: error })
  }
}

/** Resolve a path inside a package, from a chosen resolution root. */
const packageDirectory = (packageName: string, resolveFrom: NodeJS.Require): string =>
  path.dirname(manifestOf(packageName, resolveFrom))

/**
 * Resolve an executable script from a package, independent of hoisting. pnpm keeps a package's own
 * dependencies out of the consumer's `.bin`, so a bare tool name is not reliably on PATH; reading the
 * tool's manifest finds its entry point wherever the store put it.
 * @param packageName the npm package providing the tool.
 * @param binName the bin entry to resolve, defaulting to the package name.
 * @param resolveFrom the require used to locate the package; defaults to the ploaness install.
 * @returns the absolute path to the tool's JavaScript entry point.
 */
export const resolveTool = (
  packageName: string,
  binName?: string,
  resolveFrom: NodeJS.Require = nodeRequire,
): string => {
  const manifestPath: string = manifestOf(packageName, resolveFrom)
  // A tool's own manifest, so an unreadable one is the installation being broken rather than the
  // project being wrong. `format` resolves a tool outside any gate, where a raw SyntaxError would reach
  // the user as a stack trace with no mention of which package it came from.
  const read: ParsedJson = parseJsonc(readFileSync(manifestPath, 'utf8'))
  if (read.problem !== undefined) {
    throw new Error(`ploaness could not read ${manifestPath}: ${read.problem}`)
  }
  // Narrowed through the governance guards rather than asserted. `bin` is either a path or a map of
  // names to paths, and both cases are read here as what they are: an assertion would be a claim the
  // compiler cannot check, and `type-coverage --strict` counts every one as untyped.
  const declaredBin: unknown = readKey(read.value, 'bin')
  const wanted: string = binName ?? packageName
  const bin: string | undefined =
    typeof declaredBin === 'string' ? declaredBin : asStringRecord(declaredBin)[wanted]
  if (bin === undefined) {
    throw new Error(`ploaness could not resolve the "${wanted}" executable from ${packageName}`)
  }
  return path.join(path.dirname(manifestPath), bin)
}

/**
 * Resolve a tool from the CONSUMER's install rather than the harness's. Vitest, Playwright, Next, and
 * the Payload CLI must be the project's own instance: the project's specs and config import those
 * packages directly, and a second copy would load a different module registry.
 */
export const resolveProjectTool = (
  context: Context,
  packageName: string,
  binName?: string,
): string =>
  resolveTool(packageName, binName, createRequire(path.join(context.root, 'package.json')))

/**
 * Locate a package's manifest as the package at `fromManifest` resolves it.
 *
 * Resolution root matters here rather than being an implementation detail: under pnpm's strict layout
 * `@ploaness/config` is reachable from `ploaness` and from nowhere else, so walking the manifests a
 * project inherits has to re-root at each step. Undefined rather than a throw, because a package that
 * does not resolve is a fact the caller reports rather than a broken run.
 * @param packageName the package to locate.
 * @param fromManifest the manifest whose resolution rules apply.
 * @returns the absolute path to the package's own manifest, or undefined.
 */
export const manifestPathFrom = (packageName: string, fromManifest: string): string | undefined => {
  try {
    return manifestOf(packageName, createRequire(fromManifest))
  } catch {
    return undefined
  }
}

/** Locate a directory inside a package ploaness depends on, for shipped configs and assets. */
export const shippedDirectory = (packageName: string): string =>
  packageDirectory(packageName, nodeRequire)

/** Locate this module's own package directory, used to report the running harness version. */
export const cliDirectory = (): string =>
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** List the repository's tracked files, NUL-delimited so paths with spaces survive intact. */
export const trackedFiles = (root: string): readonly string[] =>
  execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
    // A directory that is not a repository is a case the caller handles, not a diagnosis to print.
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .split('\0')
    .filter((file: string): boolean => file !== '')

/** Run a git command in the project and return its trimmed stdout. */
export const git = (context: Context, commandArguments: readonly string[]): string =>
  execFileSync('git', [...commandArguments], {
    cwd: context.root,
    encoding: 'utf8',
    // git writes its own diagnosis to stderr, which for a directory that is not a repository is not a
    // finding but noise around one the caller reports itself.
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: MAX_OUTPUT_BYTES,
  }).trim()

/**
 * The pinned versions ploaness owns, read from the shipped `pins.json`.
 *
 * One reader rather than one per gate: `preflight` decided the Node floor from a constant of its own,
 * which is a rule living in the I/O layer AND a second copy of what this file already states.
 * @returns the parsed pins, or an empty record when the file cannot be read.
 */
export const readPins = (): Record<string, unknown> => {
  const pinsFile: string = path.join(shippedDirectory('@ploaness/config'), 'pins.json')
  return asRecord(readJson(pinsFile))
}

const MANIFEST: string = 'package.json'
const WORKSPACE_FILE: string = 'pnpm-workspace.yaml'

// Every directory from the working directory up to the filesystem root, nearest first, which is the
// order `findRepositoryRoot` searches.
const ancestorsOf = (directory: string): readonly string[] => {
  const parent: string = path.dirname(directory)
  return parent === directory ? [directory] : [directory, ...ancestorsOf(parent)]
}

const hasEntry = (directory: string, entry: string): boolean =>
  existsSync(path.join(directory, entry))

// Candidate project directories come from the tracked tree rather than from a filesystem walk, so a
// directory git does not know about - a build output, an ignored scratch copy, an uninstalled example -
// can never become a governed member.
// Candidate project directories come from the tracked tree rather than a filesystem walk, so a
// directory git does not know about - a build output, an ignored scratch copy - can never become a
// governed member. A directory that is not a repository at all has exactly one project, itself: the
// integration fixtures install into such a directory before any commit exists, and asking git there
// fails rather than answering.
const manifestDirectories = (root: string): readonly string[] => {
  try {
    return trackedManifestDirectories(root)
  } catch {
    // Not a repository yet. `ploaness init` is run on exactly such a tree - a fresh checkout, or a
    // workspace being adopted before its first commit - and answering "one project, the root" there
    // would scaffold the root and silently leave every other package unwired.
    return walkManifestDirectories(root)
  }
}

// Bounded and exclusionary on purpose. A full walk of a workspace would descend into every dependency's
// own dependencies; nothing ploaness governs is nested deeper than a couple of directories, and neither
// an installed package nor a tool's cache is a project this repository owns.
const WALK_DEPTH: number = 3
const isSkipped = (name: string): boolean => name.startsWith('.') || name === 'node_modules'

const walkManifestDirectories = (
  root: string,
  relative: string = ROOT_MEMBER_PATH,
  depth: number = 0,
): readonly string[] => {
  const absolute: string = relative === ROOT_MEMBER_PATH ? root : path.join(root, relative)
  const here: readonly string[] = existsSync(path.join(absolute, MANIFEST)) ? [relative] : []
  if (depth >= WALK_DEPTH) {
    return here
  }
  const children: readonly string[] = readdirSync(absolute, { withFileTypes: true })
    .filter((entry: Dirent): boolean => entry.isDirectory() && !isSkipped(entry.name))
    .flatMap((entry: Dirent): readonly string[] =>
      walkManifestDirectories(
        root,
        relative === ROOT_MEMBER_PATH ? entry.name : path.join(relative, entry.name),
        depth + 1,
      ),
    )
  return [...here, ...children]
}

const trackedManifestDirectories = (root: string): readonly string[] =>
  trackedFiles(root)
    .filter((file: string): boolean => path.basename(file) === MANIFEST)
    .map((file: string): string => {
      const directory: string = path.dirname(file)
      return directory === '' ? ROOT_MEMBER_PATH : directory
    })

const readManifest = (root: string, projectPath: string): unknown =>
  readJson(path.join(root, projectPath, MANIFEST))

// A member's settings sit on top of the repository's rather than replacing them, so a fact declared
// once at the root - a generated directory the typography ban must skip, a stricter bundle budget -
// reaches every package without being restated in each.
// The members that sit INSIDE this one, named relative to it. A member elsewhere in the tree is not
// below the directory an analyzer walks, so naming it would ignore a path that never appears; and one
// that is below must be named the way the walk will see it, from here rather than from the root.
const nestedWithin = (memberPath: string, every: readonly string[]): readonly string[] => {
  if (memberPath === ROOT_MEMBER_PATH) {
    return every.filter((other: string): boolean => other !== ROOT_MEMBER_PATH)
  }
  const prefix: string = `${memberPath}/`
  return every
    .filter((other: string): boolean => other.startsWith(prefix))
    .map((other: string): string => other.slice(prefix.length))
}

/** What building one member needs beyond the manifest it reads for itself. */
interface MemberInputs {
  readonly root: string
  readonly projectPath: string
  readonly isEnforced: boolean
  /** The repository's own settings block, which the member's own layers onto. */
  readonly repositoryBlock?: Record<string, unknown>
  readonly siblings?: readonly string[]
}

const createMember = ({
  root,
  projectPath,
  isEnforced,
  repositoryBlock = {},
  siblings = [],
}: MemberInputs): Member => {
  const packageJson: unknown = readManifest(root, projectPath)
  return {
    root: projectPath === ROOT_MEMBER_PATH ? root : path.join(root, projectPath),
    packageJson,
    settings: readMemberSettings(repositoryBlock, ploanessBlock(packageJson)),
    isEnforced,
    path: projectPath,
    isPayload: isPayloadProject(packageJson),
    siblingPaths: siblings,
  }
}

/**
 * Build the run context for a repository, discovering its governed members.
 * @param cwd the directory ploaness was invoked from, which need not be the repository root.
 * @param isEnforced false in report-only mode.
 * @returns the repository, with one member for a single-package project.
 */
export const createRepository = (cwd: string, isEnforced: boolean): Repository => {
  const root: string = findRepositoryRoot(ancestorsOf(path.resolve(cwd)), hasEntry)
  const workspaceFile: string = readText(path.join(root, WORKSPACE_FILE)) ?? ''
  const projects: readonly ProjectManifest[] = selectProjects(
    readWorkspacePackages(workspaceFile),
    manifestDirectories(root),
  ).map(
    (projectPath: string): ProjectManifest => ({
      path: projectPath,
      packageJson: readManifest(root, projectPath),
    }),
  )
  const packageJson: unknown = readManifest(root, ROOT_MEMBER_PATH)
  const memberPaths: readonly string[] = findGovernedMembers(projects)
  const members: readonly Member[] = memberPaths.map(
    (projectPath: string): Member =>
      createMember({
        root,
        projectPath,
        isEnforced,
        repositoryBlock: ploanessBlock(packageJson),
        siblings: nestedWithin(projectPath, memberPaths),
      }),
  )
  return {
    root,
    packageJson,
    settings: withMemberExclusions(readSettings(packageJson), members),
    isEnforced,
    workspaceFile,
    projects,
    members,
  }
}

// The gates that walk the tracked tree run once, at the root, while a member declares its exclusions
// relative to itself. Without this a generated directory a member correctly excused starts failing
// them, because the pattern it wrote is anchored one directory above where the gate is looking.
const withMemberExclusions = (base: Settings, members: readonly Member[]): Settings => {
  const rebased: readonly DeclaredExclusion[] = members.flatMap(
    (member: Member): readonly DeclaredExclusion[] =>
      member.settings.declaredExclusions.map(
        (entry: DeclaredExclusion): DeclaredExclusion => rebaseExclusion(member.path, entry),
      ),
  )
  const patternsFor = (setting: string): readonly string[] =>
    rebased
      .filter((entry: DeclaredExclusion): boolean => entry.setting === setting)
      .map((entry: DeclaredExclusion): string => entry.pattern)
  return {
    ...base,
    typographyExclusions: [...base.typographyExclusions, ...patternsFor('typographyExclusions')],
    javascriptAllowlist: [...base.javascriptAllowlist, ...patternsFor('javascriptAllowlist')],
  }
}

/**
 * The member a single-gate invocation is about.
 *
 * `ploaness gate <id>` names no member, so it acts on the package containing the working directory. It
 * resolves against every pnpm project rather than only the governed members, because a single gate is
 * the tool an UNGOVERNED repository is surveyed with: before `ploaness` is declared anywhere there are
 * no governed members but the root, and resolving to the root would silently measure the wrong package
 * - reporting the repository's suppression ceiling to someone standing in an application asking about
 * that application. A whole `verify` run still judges only what the repository actually governs.
 * @param repository the repository being judged.
 * @param cwd the directory ploaness was invoked from.
 * @returns the member for the innermost project containing cwd, or the first governed member.
 */
export const memberAt = (repository: Repository, cwd: string): Member | undefined => {
  const resolved: string = path.resolve(cwd)
  const containsCwd = (projectPath: string): boolean => {
    const full: string =
      projectPath === ROOT_MEMBER_PATH ? repository.root : path.join(repository.root, projectPath)
    return resolved === full || resolved.startsWith(`${full}${path.sep}`)
  }
  // The deepest match, so a nested project wins over the root that also contains it.
  const innermost: ProjectManifest | undefined = [...repository.projects]
    .filter((project: ProjectManifest): boolean => containsCwd(project.path))
    .sort(
      (left: ProjectManifest, right: ProjectManifest): number =>
        right.path.length - left.path.length,
    )[0]
  if (innermost === undefined) {
    return repository.members[0]
  }
  return (
    repository.members.find((member: Member): boolean => member.path === innermost.path) ??
    createMember({
      root: repository.root,
      projectPath: innermost.path,
      isEnforced: repository.isEnforced,
    })
  )
}

/**
 * The environment variables a gate must hand a child process that BOOTS the project.
 *
 * A Payload configuration validates `process.env` at module scope, so a tool that evaluates it needs
 * the project's own environment before it can run at all - and the Payload CLI, unlike Next, reads no
 * `.env` itself. The other three gates that boot the project were each covered by something that does:
 * `next build` reads them, and the runners ploaness ships load them from `vitest-setup.ts` and
 * `playwright.ts`. The generator was the one path with nothing on it, so it evaluated the
 * configuration with those variables absent and produced the artefacts of a project that does not
 * exist.
 *
 * Parsing is `node:util`'s, which is the parser `process.loadEnvFile` uses, so a file read here and the
 * same file read by the runners cannot be read two different ways.
 * @param context the member whose environment files are read.
 * @returns the variables to add, already narrowed to those the run does not carry.
 */
export const runEnvironment = (context: Context): Readonly<Record<string, string>> =>
  runEnvironmentOverrides(
    process.env,
    runEnvironmentFiles((relativePath: string): boolean =>
      existsSync(path.join(context.root, relativePath)),
    ).map(
      (file: string): Readonly<Record<string, string | undefined>> =>
        parseEnv(readFileSync(path.join(context.root, file), 'utf8')),
    ),
  )
