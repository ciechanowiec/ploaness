// The first inhabitant of this package that a consumer's application calls rather than a rule the
// harness applies, and the placement is deliberate rather than convenient. It is a pure function over a
// string, which is what this package holds and what its coverage floor measures; a package of its own
// for one function would be a versioning surface bought for nothing. A reader who expects only rules
// here should take this comment as the reason rather than as an accident.
//
// It exists because React does not cover this and every content-managed site needs it. React escapes
// text content, so an editor cannot inject markup through a field - but an href is an attribute, and
// `javascript:alert(1)` in a link field executes as the site the moment a visitor clicks it. Nothing in
// the framework, the type system, or a linter reports that: the value is a string and it is rendered as
// a string. Every project mapping a CMS field into an anchor has this problem, so the harness owns the
// answer rather than leaving each project to rediscover it.

/** The schemes safe to render into an anchor. A URL carrying no scheme at all is relative, and safe. */
const SAFE_SCHEMES: ReadonlySet<string> = new Set<string>(['http', 'https', 'mailto', 'tel'])

// A well-formed scheme, anchored at both ends so a relative path that merely contains a colon later -
// `/schedule:today` - is not read as declaring one.
const SCHEME_SHAPE: RegExp = /^[a-z][a-z\d+.-]*$/

// Whitespace and control characters are removed before the scheme is read, because a browser removes
// them too: a `javascript:` URL with a tab inside the scheme is still a javascript URL by the time it
// is navigated, and reading the raw string would classify it as relative and pass it straight through.
// Stripping more than a browser does can only move an input from relative to scheme-bearing, which is
// the direction that neutralises rather than admits, so the wider strip is the conservative choice.
//
// `\p{Cc}` rather than the code points themselves: a class naming them is a control character inside a
// regular expression, which the lint pass rejects and is right to, since the literal bytes would then
// sit in this file invisibly. The property escape names the category in the open, and it leaves every
// ordinary character - a hyphen in a host, for one - untouched.
const IGNORED_BY_BROWSERS: RegExp = /[\s\p{Cc}]+/gu

/** What an unsafe href is replaced with: a link that goes nowhere rather than one that runs. */
const NEUTRAL: string = '#'

const NO_COLON: number = -1

/**
 * Neutralise an untrusted href so a stored `javascript:`, `data:`, or `vbscript:` URL cannot execute
 * when it is rendered into an anchor.
 *
 * Returning {@link NEUTRAL} is this function doing its job rather than falling back silently: the
 * caller asked for an href safe to render, and a link that goes nowhere is that answer for an unsafe
 * input. A caller that must know the input was rejected compares the result against what it passed in.
 * @param href the raw href, typically authored in a CMS field.
 * @returns the href unchanged when its scheme is safe or absent, and `#` when it is neither.
 */
export const safeHref = (href: string): string => {
  const trimmed: string = href.trim()
  if (trimmed.length === 0) {
    return NEUTRAL
  }
  const readable: string = trimmed.replaceAll(IGNORED_BY_BROWSERS, '').toLowerCase()
  const colon: number = readable.indexOf(':')
  if (colon === NO_COLON) {
    return trimmed
  }
  const scheme: string = readable.slice(0, colon)
  if (!SCHEME_SHAPE.test(scheme)) {
    return trimmed
  }
  return SAFE_SCHEMES.has(scheme) ? trimmed : NEUTRAL
}
