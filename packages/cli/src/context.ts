// Everything a gate needs to know about the project it is judging, resolved once per run.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSettings, type Settings } from '@ploaness/governance'

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

/** Read a JSON file, returning undefined when it is absent or unparseable. */
export const readJson = (file: string): unknown => {
  if (!existsSync(file)) {
    return undefined
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

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
  const manifest: { readonly bin?: string | Record<string, string> } = JSON.parse(
    readFileSync(manifestPath, 'utf8'),
  ) as { readonly bin?: string | Record<string, string> }
  const wanted: string = binName ?? packageName
  const bin: string | undefined =
    typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[wanted]
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
  })
    .split('\0')
    .filter((file: string): boolean => file !== '')

/** Run a git command in the project and return its trimmed stdout. */
export const git = (context: Context, commandArguments: readonly string[]): string =>
  execFileSync('git', [...commandArguments], {
    cwd: context.root,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
  }).trim()
