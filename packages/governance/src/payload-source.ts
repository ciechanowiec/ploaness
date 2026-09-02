// The Payload half of the source reader: which object literal in a file IS a collection or a global,
// and what its own keys say.
//
// The generic scanning it stands on is in `source-text.ts`. What is here is everything that needs to
// know Payload's shape - the three ways a config is declared, and the difference between a key the
// config declares and one a field beneath it does.
import {
  balancedArguments,
  type Folded,
  LAST_CHARACTER,
  NOT_FOUND,
  type ScanStep,
  scanDelimited,
  topLevelKeys,
} from './source-text.js'

/** A Payload usage defect found in project source. */
export interface PayloadViolation {
  readonly line: number
  readonly rule: string
  readonly reason: string
}

// Where a key sits directly inside the outermost object literal, rather than inside something nested in
// it. Searching the text instead would find a field-level `access` block and read it as the collection's
// own, which is exactly the omission the access rules exist to catch.
//
// The boundary requirement is the same one `TOP_LEVEL_KEY` carries, and for the same reason: the scan
// visits every offset, so a pattern anchored only at the start of the remaining text matched mid-word.
// `oauth:` was read as `auth:` and reported a collection with no auth as one with unhardened auth. The
// delimiter is required rather than merely allowed, so the returned offset is the brace or comma that
// opens the key rather than the key itself; every reader below looks forward from it either way.
const depthOneKeyIndex = (text: string, key: string): number => {
  const pattern: RegExp = new RegExp(String.raw`^[{,]\s*${key}\s*:`)
  return scanDelimited<number>(
    text,
    0,
    (found: number, step: ScanStep): Folded<number> =>
      step.depth === 1 && pattern.test(text.slice(step.index))
        ? { state: step.index, stop: true }
        : { state: found, stop: false },
    NOT_FOUND,
  )
}

/**
 * The raw text of a depth-one key's value, from its colon to the end of the enclosing literal.
 * @param wrapped the config body, brace-delimited.
 * @param key the key to read.
 * @returns the text after the key's colon, or undefined when the key is not declared at depth one.
 */
export const depthOneValue = (wrapped: string, key: string): string | undefined => {
  const at: number = depthOneKeyIndex(wrapped, key)
  if (at === NOT_FOUND) {
    return undefined
  }
  const colon: number = wrapped.indexOf(':', at)
  return colon === NOT_FOUND ? undefined : wrapped.slice(colon + 1)
}

/**
 * The keys declared inside a depth-one key's own object literal.
 * @param wrapped the config body, brace-delimited.
 * @param key the key whose block to read.
 * @returns the block's depth-one keys, or an empty list when the key is absent.
 */
export const depthOneBlockKeys = (wrapped: string, key: string): readonly string[] => {
  const value: string | undefined = depthOneValue(wrapped, key)
  return value?.trimStart().startsWith('{') === true ? topLevelKeys(value, 0) : []
}

/** A brace-delimited literal: where it opens and where it closes. */
interface LiteralSpan {
  readonly open: number
  readonly close: number
}

const withClose = (spans: readonly LiteralSpan[], close: number): readonly LiteralSpan[] => {
  const last: LiteralSpan | undefined = spans.at(LAST_CHARACTER)
  return last?.close === NOT_FOUND
    ? [...spans.slice(0, LAST_CHARACTER), { open: last.open, close }]
    : spans
}

// Every module-level `{ ... }` in the file, collected in one pass. The `satisfies` form writes the type
// AFTER the value, so its body cannot be found by scanning forward from the marker the way an
// annotation's can - it is the literal that closes just before the marker instead, and finding that by
// walking backwards would mean a second scanner that cannot skip string literals.
const moduleLiterals = (source: string): readonly LiteralSpan[] =>
  scanDelimited<readonly LiteralSpan[]>(
    source,
    0,
    (spans: readonly LiteralSpan[], step: ScanStep): Folded<readonly LiteralSpan[]> => {
      if (step.character === '{' && step.depth === 1) {
        return { state: [...spans, { open: step.index, close: NOT_FOUND }], stop: false }
      }
      return step.character === '}' && step.depth === 0
        ? { state: withClose(spans, step.index), stop: false }
        : { state: spans, stop: false }
    },
    [],
  )

/**
 * The brace-delimited body of the config a marker names, in either declaration order.
 * @param source the file contents.
 * @param marker the offset of the type reference.
 * @param isTrailing true when the type follows the value, as `satisfies` does.
 * @returns the body wrapped in its own braces, or undefined when no literal belongs to the marker.
 */
export const configBody = (
  source: string,
  marker: number,
  isTrailing: boolean,
): string | undefined => {
  const open: number = isTrailing
    ? (moduleLiterals(source)
        .filter((span: LiteralSpan): boolean => span.close !== NOT_FOUND && span.close < marker)
        .at(LAST_CHARACTER)?.open ?? NOT_FOUND)
    : source.indexOf('{', marker)
  if (open === NOT_FOUND) {
    return undefined
  }
  const body: string | undefined = balancedArguments(source, open)
  return body === undefined ? undefined : `{${body}}`
}
