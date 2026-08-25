// One escaper, because two rules build a pattern out of text a project supplies.
//
// `secret-policy.ts` renders a declared exception path into a scanner's allowlist, and
// `payload-source.ts` searches for a literal call expression such as `payload.find(`. Both had their
// own copy of this function, character for character, in modules that never import each other - which
// is the shape of duplication that survives a review precisely because neither copy looks wrong.
const REGEX_METACHARACTERS: RegExp = /[.*+?^${}()|[\]\\]/g

/**
 * Escape every character a regular expression would read as syntax.
 * @param text the literal to match.
 * @returns the text, safe to embed in a pattern.
 */
export const escapeForRegex = (text: string): string =>
  text.replaceAll(REGEX_METACHARACTERS, String.raw`\$&`)
