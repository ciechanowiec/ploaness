// Config-reference integrity policy: the pure logic that finds LITERAL source-file paths carved out of
// (or into) a tool config - a Biome `includes`, an ESLint `ignores`, a Vitest `coverageExclude` - that
// no longer exist on disk. The `config-refs` gate in packages/cli/src/checks/references.ts reads the
// config files and probes the filesystem.
//
// This is the sibling of the doc-rot gate (document-references.ts), applied to configs instead of docs,
// and chosen to be HIGH-SIGNAL and false-positive-free. A quoted token is only checked when it is
// unambiguously a concrete project file: it starts with a known source directory (`src/`, `tests/`,
// `scripts/`, `public/`), carries a file extension, and contains NO glob or regex metacharacter. Globs
// (`src/**/*.tsx`), path regexes (`^src/lib/`), and bare tokens are deliberately ignored, because a
// config legitimately uses those and existence-checking them would make the gate lie. A leading `!`
// (Biome negation) is stripped before the path is returned.

// The directories a carve-out may name. `DEFAULT_SOURCE_ROOTS` is imported rather than restated - the
// three names were written out here as a second alternation, so a change to either list left the other
// describing a project that no longer exists. `public` is added on top because a config legitimately
// carves out a static asset, and no source root claims that directory.
const CARVE_OUT_DIRECTORIES: readonly string[] = [...DEFAULT_SOURCE_ROOTS, 'public']

import { DEFAULT_SOURCE_ROOTS } from './settings.js'
import { escapeForRegex } from './text-escapes.js'

// A quoted string whose content, after an optional leading `!`, starts with one of those directories and
// ends with a file extension. The three quote styles cover JSON (`"`) and JS/TS config literals
// (`'`, `` ` ``).
const CARVE_OUT_ALTERNATION: string = CARVE_OUT_DIRECTORIES.map((directory: string): string =>
  escapeForRegex(directory),
).join('|')

const LITERAL_SOURCE_PATH: RegExp = new RegExp(
  String.raw`(['"\`])(!?(?:${CARVE_OUT_ALTERNATION})/[^'"\`\n]*?\.[A-Za-z0-9]+)\1`,
  'g',
)

// Glob and regex metacharacters. A token carrying any of these is a pattern, not a concrete path, so it
// cannot be existence-checked and is dropped.
const METACHARACTER: RegExp = /[*?[\]{}()|^$\\+]/

/**
 * Extract the concrete, existence-checkable source paths a config file references. Returns each unique
 * path (sorted for deterministic output) with any leading `!` negation stripped; glob/regex patterns
 * and non-source tokens are excluded.
 */
export const extractLiteralSourcePaths = (content: string): readonly string[] => {
  const candidates: readonly string[] = [...content.matchAll(LITERAL_SOURCE_PATH)]
    // The second group is the quoted body, which the pattern always captures when it matches. The
    // conversion is written out rather than guarded, because a guard here would describe a case that
    // cannot occur and would report as an untested branch forever.
    .map((match: RegExpExecArray): string => String(match[2]))
    .map((token: string): string => (token.startsWith('!') ? token.slice(1) : token))
    .filter((candidate: string): boolean => !METACHARACTER.test(candidate))
  const paths: ReadonlySet<string> = new Set<string>(candidates)
  return [...paths].sort((left: string, right: string): number => left.localeCompare(right))
}

/** A config path reference that no longer resolves to a real file. */
export interface ConfigReferenceViolation {
  readonly path: string
  readonly reason: string
}

/**
 * Return every extracted path that does not exist, with `isExistingFile` injected so the core stays pure. An
 * empty array means every source file the config carves out is still present.
 */
export const findMissingConfigReferences = (
  paths: readonly string[],
  isExistingFile: (relativePath: string) => boolean,
): readonly ConfigReferenceViolation[] =>
  paths
    .filter((path: string): boolean => !isExistingFile(path))
    .map(
      (path: string): ConfigReferenceViolation => ({
        path,
        reason: 'carved out of a tool config but the file does not exist',
      }),
    )
