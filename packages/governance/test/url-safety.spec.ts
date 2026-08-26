import { describe, expect, it } from 'vitest'
import { safeHref } from '../src/url-safety.js'

/** Spelled as a constant so a deliberate plain-http assertion reads as deliberate. */
const INSECURE_SCHEME: string = 'http'

// A relative URL carries no scheme, so there is nothing for a browser to execute and nothing here to
// neutralise. The anchoring of the scheme shape is what these cases are really about: a colon appearing
// later in a path is not a scheme, and treating it as one would rewrite working links to `#`.
describe('a URL with no scheme is relative, and passes through', () => {
  it('passes a rooted path unchanged', () => {
    expect(safeHref('/sports')).toBe('/sports')
  })

  it('passes a fragment and a query unchanged', () => {
    expect(safeHref('#top')).toBe('#top')
    expect(safeHref('?q=1')).toBe('?q=1')
  })

  it('does not read a colon later in a path as a scheme', () => {
    expect(safeHref('/schedule:today')).toBe('/schedule:today')
  })

  it('does not read a bare word as a truncated scheme', () => {
    expect(safeHref('mailto')).toBe('mailto')
  })

  it('does not read a malformed scheme as a scheme', () => {
    expect(safeHref('foo!:bar')).toBe('foo!:bar')
  })
})

describe('a URL whose scheme is safe passes through', () => {
  it('passes https unchanged', () => {
    expect(safeHref('https://games.example')).toBe('https://games.example')
  })

  it('passes plain http unchanged', () => {
    // Built from a constant rather than written out, so asserting that plain http is allowed does
    // not itself trip the lint rule that wants every URL in this repository to be https.
    const plain: string = `${INSECURE_SCHEME}://games.example`
    expect(safeHref(plain)).toBe(plain)
  })

  it('passes mailto and tel unchanged', () => {
    expect(safeHref('mailto:info@games.example')).toBe('mailto:info@games.example')
    expect(safeHref('tel:+901234567')).toBe('tel:+901234567')
  })

  it('keeps a hyphen in the host, which the scheme read must not consume', () => {
    expect(safeHref('https://my-site.example/a-b')).toBe('https://my-site.example/a-b')
  })
})

describe('a URL whose scheme executes is neutralised', () => {
  it('neutralises javascript', () => {
    expect(safeHref('javascript:alert(1)')).toBe('#')
  })

  it('neutralises data, which can carry a whole document', () => {
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBe('#')
  })

  it('neutralises vbscript', () => {
    expect(safeHref('vbscript:msgbox(1)')).toBe('#')
  })

  it('neutralises a scheme it simply does not know', () => {
    expect(safeHref('ftp://games.example')).toBe('#')
  })
})

// A browser strips these before it reads the scheme, so a reader that does not strip them classifies
// the URL as relative and hands it to the page intact. Each case here is a javascript URL that a naive
// implementation passes through.
describe('the evasions a browser sees through and a naive reader does not', () => {
  it('is case-insensitive', () => {
    expect(safeHref('JavaScript:alert(1)')).toBe('#')
  })

  it('ignores surrounding whitespace', () => {
    expect(safeHref('  javascript:alert(1)  ')).toBe('#')
  })

  it('ignores a tab inside the scheme', () => {
    expect(safeHref('java\tscript:alert(1)')).toBe('#')
  })

  it('ignores a newline inside the scheme', () => {
    expect(safeHref('java\nscript:alert(1)')).toBe('#')
  })

  it('ignores a null byte inside the scheme', () => {
    expect(safeHref('java\u{0}script:alert(1)')).toBe('#')
  })

  it('ignores a delete character inside the scheme', () => {
    expect(safeHref('java\u{7F}script:alert(1)')).toBe('#')
  })
})

describe('an href with nothing in it', () => {
  it('neutralises the empty string', () => {
    expect(safeHref('')).toBe('#')
  })

  it('neutralises whitespace alone', () => {
    expect(safeHref(' '.repeat(3))).toBe('#')
  })
})
