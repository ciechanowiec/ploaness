// Doc-rot policy: the pure logic that finds references in the agent docs (AGENTS.md, CLAUDE.md) which
// no longer match reality. The `docs` gate in packages/cli/src/checks/references.ts reads the files.
//
// Two reference kinds are validated, both chosen to be HIGH-SIGNAL and false-positive-free:
//   1. Script references - a backticked npm-script token (`lint:arch`, `verify:full`, `knip`, ...) or a
//      `pnpm run <name>` invocation - must name a script that exists in package.json.
//   2. Path references - a backticked FULL repository path to a concrete file (contains `/` and a file
//      extension) - must exist on disk. Directory/glob references (`src/access/**`) and bare filenames
//      are deliberately NOT checked: docs legitimately mention not-yet-existing dirs (e.g. the
//      "no src/migrations yet" note) and use shorthand, and flagging those would make the gate lie.
import { ROOT_MEMBER_PATH } from './workspace-policy.js'

/** A documentation reference that no longer resolves to a real script or file. */
export interface DocumentViolation {
  readonly reference: string
  readonly kind: 'script' | 'path'
  readonly reason: string
}

/** Inputs for {@link findDocumentReferenceViolations}, with `isExistingFile` injected so the core stays pure. */
interface DocumentReferenceInputs {
  readonly markdown: string
  readonly scriptNames: ReadonlySet<string>
  readonly isExistingFile: (relativePath: string) => boolean
  /**
   * Words that look like a script name but are not one, so a mention of them is not rot. Under ploaness
   * the gate identifiers (`knip`, `tests`, `build`) share a vocabulary with the old npm scripts they
   * replaced, and documenting a gate must not be read as referencing a script that no longer exists.
   */
  readonly reservedWords: ReadonlySet<string>
  /**
   * The dependency names this document may name a subpath of. A token beginning with one is a module
   * SPECIFIER rather than a repository path, so it is not judged as a file.
   */
  readonly packageNames: ReadonlySet<string>
}

const BACKTICK_TOKEN: RegExp = /`[^`\n]+`/g
const PNPM_RUN: RegExp = /pnpm run [a-z][a-z0-9:_-]*/g
// The FAMILIES a backticked token has to belong to before it is read as a script reference. This named
// `ensure:db` and `with:test-db` as literals, so the whitelist recognised two particular scripts rather
// than the shape of one: a project that renamed `ensure:db` to `ensure:services` had every backticked
// mention of the new name quietly stop being checked, and the gate then passed having dropped the
// reference rather than resolved it. A family is what a whitelist here is for; a specific script name
// is what it must never be.
const SCRIPT_TOKEN: RegExp =
  /^(?:verify(?::full)?|format|knip|(?:lint|test|generate|ensure|with|seed):[a-z][a-z:-]*)$/
const PATH_EXTENSION: RegExp = /\.(?:tsx?|mts|cts|mjs|cjs|js|jsonc?|ya?ml|md|css|scss|grit)$/
const PNPM_RUN_PREFIX: string = 'pnpm run '

const backtickTokens = (markdown: string): readonly string[] =>
  (markdown.match(BACKTICK_TOKEN) ?? []).map((raw: string): string => raw.slice(1, -1).trim())

const pnpmRunScripts = (markdown: string): readonly string[] =>
  (markdown.match(PNPM_RUN) ?? []).map((raw: string): string => raw.slice(PNPM_RUN_PREFIX.length))

// Strip a trailing `/**` or `/*` glob so `src/access/**` becomes `src/access`; a token with any other
// `*` cannot be existence-checked and is dropped by the caller.
const stripTrailingGlob = (token: string): string => token.replace(/\/\*\*?$/, '')

const extractScriptReferences = (markdown: string): ReadonlySet<string> => {
  const backticked: readonly string[] = backtickTokens(markdown).filter((token: string): boolean =>
    SCRIPT_TOKEN.test(token),
  )
  return new Set([...backticked, ...pnpmRunScripts(markdown)])
}

// A token beginning with the name of a declared dependency is a module SPECIFIER, not a repository
// path, and the header above says this rule judges repository paths. `ploaness/tsconfig.json` is the
// case that forced the distinction: the wiring gate mandates that exact `extends` value, so a project
// documenting what another gate REQUIRES was reported for naming a file it is obliged to name.
//
// The exemption is derived from what the project declares rather than from a list of the harness's own
// subpaths, which keeps the useful half: drop the dependency and the same reference is rot again.
// A scope and a name: the most of a specifier that can still be a package name.
const PACKAGE_NAME_SEGMENTS: number = 2

const specifierPackage = (token: string): string => {
  const [first = '', second = '']: readonly string[] = token.split('/', PACKAGE_NAME_SEGMENTS)
  return first.startsWith('@') ? `${first}/${second}` : first
}

const extractPathReferences = (
  markdown: string,
  packageNames: ReadonlySet<string>,
): ReadonlySet<string> => {
  const paths: readonly string[] = backtickTokens(markdown)
    .filter((token: string): boolean => token.includes('/') && !token.includes(' '))
    .map((token: string): string => stripTrailingGlob(token))
    .filter((token: string): boolean => !token.includes('*') && PATH_EXTENSION.test(token))
    .filter((token: string): boolean => !packageNames.has(specifierPackage(token)))
  return new Set(paths)
}

/**
 * Return every documentation reference that no longer resolves: a named script absent from
 * package.json, or a full-path file that does not exist. An empty array means the docs are in sync.
 */
export const findDocumentReferenceViolations = (
  inputs: DocumentReferenceInputs,
): readonly DocumentViolation[] => {
  const scriptViolations: readonly DocumentViolation[] = [
    ...extractScriptReferences(inputs.markdown),
  ]
    .filter(
      (name: string): boolean => !(inputs.scriptNames.has(name) || inputs.reservedWords.has(name)),
    )
    .map(
      (name: string): DocumentViolation => ({
        reference: name,
        kind: 'script',
        reason: 'no matching script in package.json',
      }),
    )

  const pathViolations: readonly DocumentViolation[] = [
    ...extractPathReferences(inputs.markdown, inputs.packageNames),
  ]
    .filter((path: string): boolean => !inputs.isExistingFile(path))
    .map(
      (path: string): DocumentViolation => ({
        reference: path,
        kind: 'path',
        reason: 'referenced file does not exist',
      }),
    )

  return [...scriptViolations, ...pathViolations]
}

// Which instruction files a repository has, and whose scripts each one is read against. This was a
// constant list joined onto the repository root, which meant a workspace's member docs were never read
// at all: a real project carried three AGENTS.md, two of them naming a config file the harness forbids
// and a pipeline no commit ever added, past a gate reporting that every reference resolved.
//
// The root is a candidate whether or not it is a MEMBER, and that is the whole reason this is a
// function rather than a mapped member list. pnpm does not require the workspace root to appear in
// `packages:`, and the project that exposed the defect does not list it - so deriving the candidates
// from the member list alone would have stopped reading the root's own docs, trading one blind spot
// for the other.

/** The instruction files an agent reads, in the order it meets them. */
const DOCUMENT_FILES: readonly string[] = ['AGENTS.md', 'CLAUDE.md']

/** One instruction file, paired with the member that owns it. */
export interface DocumentLocation {
  /** Repo-relative path of the file. */
  readonly file: string
  /** Repo-relative directory it belongs to, {@link ROOT_MEMBER_PATH} at the repository root. */
  readonly directory: string
}

const joinPath = (directory: string, file: string): string =>
  directory === ROOT_MEMBER_PATH ? file : `${directory}/${file}`

/**
 * Locate every agent instruction file this repository holds.
 * @param memberPaths the governed members, repo-relative.
 * @param isExistingFile whether a repo-relative path exists.
 * @returns one entry per file present, the root's first, then each member's in the order given.
 */
export const findAgentDocuments = (
  memberPaths: readonly string[],
  isExistingFile: (relativePath: string) => boolean,
): readonly DocumentLocation[] =>
  [ROOT_MEMBER_PATH, ...memberPaths.filter((path: string): boolean => path !== ROOT_MEMBER_PATH)]
    .flatMap((directory: string): readonly DocumentLocation[] =>
      DOCUMENT_FILES.map(
        (file: string): DocumentLocation => ({ file: joinPath(directory, file), directory }),
      ),
    )
    .filter((location: DocumentLocation): boolean => isExistingFile(location.file))
