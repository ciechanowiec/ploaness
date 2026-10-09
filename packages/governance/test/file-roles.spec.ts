import { describe, expect, it } from 'vitest'
import {
  CODE_EXTENSIONS,
  hasExtension,
  isBinary,
  isGovernedCode,
  matchesGlob,
  matchesRole,
  PROSE_EXTENSIONS,
} from '../src/file-roles.js'

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('isBinary', () => {
  it('accepts text as text', () => {
    expect(isBinary(bytesOf('a plain source line\n'))).toBe(false)
  })

  it('accepts an empty file, which encodes nothing binary', () => {
    expect(isBinary(new Uint8Array([]))).toBe(false)
  })

  it('reports a NUL byte as binary content', () => {
    expect(isBinary(new Uint8Array([0x50, 0x4e, 0x47, 0x00, 0x1a]))).toBe(true)
  })

  it('recognises binary content after a long text prefix', () => {
    expect(isBinary(bytesOf(`${'header\n'.repeat(6000)}\0payload`))).toBe(true)
  })

  it.each([
    [0xff, 0xfe],
    [0xc0, 0xaf],
    [0xe2, 0x82],
  ])('recognises non-UTF-8 bytes without requiring a NUL: %j', (...bytes: readonly number[]): void => {
    expect(isBinary(new Uint8Array(bytes))).toBe(true)
  })

  it('checks UTF-8 validity beyond a long text prefix', () => {
    const bytes: Uint8Array = new Uint8Array([...bytesOf('header\n'.repeat(6000)), 0xff])
    expect(isBinary(bytes)).toBe(true)
  })

  it.each(['%PDF-1.7\n', '%PDF-2.0\r\n', '%PDF-1.4\r'])(
    'recognises an entirely text-encoded PDF by its header: %j',
    (header: string): void => {
      expect(isBinary(bytesOf(`${header}1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF`))).toBe(true)
    },
  )

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><text>Zażółć İstanbul 東京</text></svg>\n',
    '{"name":"Zażółć İstanbul 東京"}\n',
    'The PDF header is %PDF-1.7\n',
    '%PDF-example is ordinary text\n',
  ])('keeps valid Unicode and text formats in scope: %j', (text: string): void => {
    expect(isBinary(bytesOf(text))).toBe(false)
  })

  it('does not split a Unicode character at a probe boundary', () => {
    expect(isBinary(bytesOf(`${'a'.repeat(8191)}東京\n`))).toBe(false)
  })

  it('decides from the content rather than from a name', () => {
    expect(isBinary(bytesOf('#!/bin/sh\necho hello\n'))).toBe(false)
  })
})

describe('hasExtension', () => {
  it('recognises a code extension', () => {
    expect(hasExtension('src/a.ts', CODE_EXTENSIONS)).toBe(true)
  })

  it('does not treat prose as code', () => {
    expect(hasExtension('README.adoc', CODE_EXTENSIONS)).toBe(false)
  })

  it('recognises the prose roles the line cap does not apply to', () => {
    expect(hasExtension('README.adoc', PROSE_EXTENSIONS)).toBe(true)
  })

  it('covers the style-sheet extensions the css gate reads', () => {
    expect(hasExtension('src/app.css', CODE_EXTENSIONS)).toBe(true)
  })
})

describe('matchesRole', () => {
  it('excludes a path a declared pattern names', () => {
    expect(matchesRole('src/payload-types.ts', [String.raw`payload-types\.ts$`])).toBe(true)
  })

  it('leaves a path no pattern names', () => {
    expect(matchesRole('src/lib/reads.ts', [String.raw`payload-types\.ts$`])).toBe(false)
  })

  it('excludes nothing when no role is declared', () => {
    expect(matchesRole('src/lib/reads.ts', [])).toBe(false)
  })
})

describe('isGovernedCode', () => {
  it('governs an ordinary source file', () => {
    expect(isGovernedCode('src/lib/reads.ts', [])).toBe(true)
  })

  it('does not govern a file a declared generated role excludes', () => {
    expect(isGovernedCode('src/payload-types.ts', [String.raw`payload-types\.ts$`])).toBe(false)
  })

  it('does not govern prose, which the Code Rules are not about', () => {
    expect(isGovernedCode('README.adoc', [])).toBe(false)
  })
})

// The coverage settings are written as globs, not as the regular expressions `matchesRole` reads. Each
// token here decides how far a pattern reaches, and reading one of them alike would silently widen every
// exclusion that uses it.
describe('matchesGlob', () => {
  it('matches a literal path with no token in it', () => {
    expect(matchesGlob('src/payload-types.ts', 'src/payload-types.ts')).toBe(true)
  })

  it('reads a period as a period rather than as any character', () => {
    expect(matchesGlob('src/payload-types.ts', 'src/payload/types.ts')).toBe(false)
  })

  it('lets a single star cross no directory boundary', () => {
    expect(matchesGlob('src/*.ts', 'src/lib/reads.ts')).toBe(false)
  })

  it('matches a single star within one segment', () => {
    expect(matchesGlob('src/*.ts', 'src/reads.ts')).toBe(true)
  })

  it('lets a double star cross any number of boundaries', () => {
    expect(matchesGlob('src/app/**', 'src/app/(payload)/admin/page.tsx')).toBe(true)
  })

  it('lets a double-star segment stand for no directory at all', () => {
    expect(matchesGlob('src/**/*.tsx', 'src/page.tsx')).toBe(true)
  })

  it('lets a double-star segment stand for several directories', () => {
    expect(matchesGlob('src/**/*.tsx', 'src/blocks/hero/index.tsx')).toBe(true)
  })

  it('matches exactly one character for a question mark', () => {
    expect(matchesGlob('src/page?.ts', 'src/page1.ts')).toBe(true)
  })

  it('does not let a question mark stand for two characters', () => {
    expect(matchesGlob('src/page?.ts', 'src/page12.ts')).toBe(false)
  })

  it('anchors the pattern, so a prefix match is not a match', () => {
    expect(matchesGlob('src/lib', 'src/lib/reads.ts')).toBe(false)
  })
})
