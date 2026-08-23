// Doc-rot policy: the pure logic that finds references in the agent docs (AGENTS.md, CLAUDE.md) which
// no longer match reality. The CLI that reads the files and exits is in scripts/check-documentation.ts.
//
// Two reference kinds are validated, both chosen to be HIGH-SIGNAL and false-positive-free:
//   1. Script references - a backticked npm-script token (`lint:arch`, `verify:full`, `knip`, ...) or a
//      `pnpm run <name>` invocation - must name a script that exists in package.json.
//   2. Path references - a backticked FULL repository path to a concrete file (contains `/` and a file
//      extension) - must exist on disk. Directory/glob references (`src/access/**`) and bare filenames
//      are deliberately NOT checked: docs legitimately mention not-yet-existing dirs (e.g. the
//      "no src/migrations yet" note) and use shorthand, and flagging those would make the gate lie.

/** A documentation reference that no longer resolves to a real script or file. */
export interface DocumentViolation {
  readonly reference: string
  readonly kind: 'script' | 'path'
  readonly reason: string
}

/** Inputs for {@link findDocumentReferenceViolations}, with `fileExists` injected so the core stays pure. */
interface DocumentReferenceInputs {
  readonly markdown: string
  readonly scriptNames: ReadonlySet<string>
  readonly fileExists: (relativePath: string) => boolean
  /**
   * Words that look like a script name but are not one, so a mention of them is not rot. Under ploaness
   * the gate identifiers (`knip`, `tests`, `build`) share a vocabulary with the old npm scripts they
   * replaced, and documenting a gate must not be read as referencing a script that no longer exists.
   */
  readonly reservedWords: ReadonlySet<string>
}

const BACKTICK_TOKEN: RegExp = /`[^`\n]+`/g
const PNPM_RUN: RegExp = /pnpm run [a-z][a-z0-9:_-]*/g
const SCRIPT_TOKEN: RegExp =
  /^(?:verify(?::full)?|format|knip|(?:lint|test|generate):[a-z][a-z:-]*|ensure:db|with:test-db)$/
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

const extractPathReferences = (markdown: string): ReadonlySet<string> => {
  const paths: readonly string[] = backtickTokens(markdown)
    .filter((token: string): boolean => token.includes('/') && !token.includes(' '))
    .map((token: string): string => stripTrailingGlob(token))
    .filter((token: string): boolean => !token.includes('*') && PATH_EXTENSION.test(token))
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

  const pathViolations: readonly DocumentViolation[] = [...extractPathReferences(inputs.markdown)]
    .filter((path: string): boolean => !inputs.fileExists(path))
    .map(
      (path: string): DocumentViolation => ({
        reference: path,
        kind: 'path',
        reason: 'referenced file does not exist',
      }),
    )

  return [...scriptViolations, ...pathViolations]
}
