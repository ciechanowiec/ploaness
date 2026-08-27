// The small reader for the top-level blocks pnpm reads out of a workspace file.
//
// It is not a YAML parser and must not become one. pnpm honours these keys only at the top level of
// `pnpm-workspace.yaml`, so what has to be recognised is exactly "an unindented key, and the indented
// lines beneath it" - a shape a regex reads correctly and a parser would only read more expensively.
//
// It lives here rather than in `install-policy.ts`, which wrote it first, because `workspace-policy.ts`
// needs the same three predicates to read the `packages:` block. Two crude readers in one package would
// not stay equal, and the one that drifted would be the one deciding which directories are governed.

const isTopLevelKey = (line: string, key: string): boolean =>
  new RegExp(String.raw`^${key}\s*:`).test(line)

const isIndented = (line: string): boolean => /^\s+\S/.test(line)

/**
 * Whether an install config declares a top-level key at all.
 *
 * Separate from reading the block because a key can be meaningful while its body is empty:
 * `onlyBuiltDependencies: []` permits no dependency to run a script, which is an answer rather than
 * an omission.
 * @param file the contents of a YAML file, or an empty string when it is absent.
 * @param key the top-level key to look for.
 * @returns true when the key appears unindented.
 */
export const declaresTopLevelKey = (file: string, key: string): boolean =>
  file.split('\n').some((line: string): boolean => isTopLevelKey(line, key))

/**
 * The lines of one top-level block, which run until the next unindented line.
 * @param file the contents of a YAML file, or an empty string when it is absent.
 * @param key the top-level key whose body to read.
 * @returns the block's lines, or an empty array when the key is absent.
 */
export const topLevelBlockLines = (file: string, key: string): readonly string[] => {
  const lines: readonly string[] = file.split('\n')
  const start: number = lines.findIndex((line: string): boolean => isTopLevelKey(line, key))
  if (start === -1) {
    return []
  }
  const rest: readonly string[] = lines.slice(start + 1)
  const end: number = rest.findIndex(
    (line: string): boolean => line.trim().length > 0 && !isIndented(line),
  )
  return end === -1 ? rest : rest.slice(0, end)
}

/**
 * Strip one layer of matching or unmatched surrounding quotes.
 * @param value the raw scalar.
 * @returns the value without its surrounding quote characters.
 */
export const withoutQuotes = (value: string): string => value.replaceAll(/^['"]|['"]$/g, '')

// A whole-line comment is not content. Trailing text after a `#` is stripped only where it cannot be
// part of a value: a path glob carries no `#`, but an override specifier does - `git+ssh://host/repo#tag`
// is a legal pin, and cutting at the `#` would silently rewrite which commit the rule judges.
const contentLines = (lines: readonly string[]): readonly string[] =>
  lines
    .map((line: string): string => line.trim())
    .filter((line: string): boolean => line.length > 0 && !line.startsWith('#'))

const withoutTrailingComment = (line: string): string => {
  const hash: number = line.indexOf('#')
  return hash === -1 ? line : line.slice(0, hash).trim()
}

/**
 * The items of a top-level YAML sequence, such as the `packages:` block of a workspace file.
 * @param file the contents of a YAML file, or an empty string when it is absent.
 * @param key the top-level key whose sequence to read.
 * @returns one unquoted entry per `- item` line, in declaration order.
 */
export const topLevelListItems = (file: string, key: string): readonly string[] =>
  contentLines(topLevelBlockLines(file, key))
    .filter((line: string): boolean => line.startsWith('-'))
    .map((line: string): string => withoutQuotes(withoutTrailingComment(line.slice(1).trim())))
    .filter((entry: string): boolean => entry.length > 0)

/**
 * The `key: value` entries of a top-level YAML mapping, such as an `overrides:` block.
 *
 * Split at the FIRST colon, not the last: a value carries colons of its own - `npm:preact@10`,
 * `link:../fork`, `git+ssh://...` - and splitting at the last one read `react: npm:preact@10` as a
 * package called "react: npm", so every alias form walked straight through the rule meant to catch it.
 * @param file the contents of a YAML file, or an empty string when it is absent.
 * @param key the top-level key whose mapping to read.
 * @returns one `[name, value]` pair per entry, both unquoted.
 */
export const topLevelMappingEntries = (
  file: string,
  key: string,
): readonly (readonly [string, string])[] =>
  contentLines(topLevelBlockLines(file, key)).flatMap(
    (line: string): readonly (readonly [string, string])[] => {
      const separator: number = line.indexOf(':')
      if (separator === -1) {
        return []
      }
      return [
        [
          withoutQuotes(line.slice(0, separator).trim()),
          withoutQuotes(line.slice(separator + 1).trim()),
        ],
      ]
    },
  )
