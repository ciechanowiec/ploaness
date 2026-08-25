// The one escaper three rules build patterns with.
//
// Nothing exercised it directly. It is reached through the secret allowlist, the licence splitter, the
// config-reference reader and the source scanner, and each of those passes it the literals ITS rule
// happens to carry - so the character that breaks it is the one no caller has met yet. A pattern that
// escapes too little turns project-supplied text into syntax; one that escapes too much stops matching
// the literal it was built from, and neither shows up as a failure in this module.
import { describe, expect, it } from 'vitest'
import { escapeForRegex } from '../src/text-escapes.js'

// Every character a regular expression reads as syntax, so a character added to the pattern without
// being added here fails the round trip below rather than passing unnoticed. The order is not the
// pattern's: `$` is moved off the front of `{` so the literal does not spell a template interpolation,
// which is a self-reference the same shape as the one the typography rule solves by naming code points.
const METACHARACTERS: string = '{}()|[].*+?^$\\'

describe('escapeForRegex', () => {
  it('leaves text carrying no syntax unchanged', () => {
    // A slash is not syntax to a pattern built from a string, only to a regex literal - which is why
    // the callers build theirs with the RegExp constructor.
    expect(escapeForRegex('src/lib/reads')).toBe('src/lib/reads')
  })

  // The property that matters: whatever the input, the pattern built from it matches that input and
  // reads none of it as syntax.
  it('produces a pattern that matches the literal it was built from', () => {
    for (const literal of [
      METACHARACTERS,
      'tests/fixtures/keys (old).json',
      String.raw`src\windows\path.ts`,
      'a.b*c+d?e',
      '(MIT OR Apache-2.0)',
    ]) {
      expect(new RegExp(`^${escapeForRegex(literal)}$`).test(literal)).toBe(true)
    }
  })

  it('stops a metacharacter from matching anything but itself', () => {
    // Unescaped, `a.c` matches `abc`; escaped, only the literal dot does.
    expect(new RegExp(`^${escapeForRegex('a.c')}$`).test('abc')).toBe(false)
    // Unescaped, the group would match the empty string and the alternation would match either half.
    expect(new RegExp(`^${escapeForRegex('(a|b)*')}$`).test('')).toBe(false)
    expect(new RegExp(`^${escapeForRegex('(a|b)*')}$`).test('(a|b)*')).toBe(true)
  })

  it('escapes every metacharacter rather than the first of each', () => {
    expect(escapeForRegex('...')).toBe(String.raw`\.\.\.`)
  })

  // Without doubling, a literal ending in a backslash would escape whatever the caller appends to the
  // pattern - an anchor, a group, or the next alternative - rather than standing for itself.
  it('escapes a backslash rather than leaving it to escape what follows', () => {
    expect(() => new RegExp(`${escapeForRegex('\\')}$`)).not.toThrow()
    expect(new RegExp(`^${escapeForRegex('\\')}$`).test('\\')).toBe(true)
  })
})
