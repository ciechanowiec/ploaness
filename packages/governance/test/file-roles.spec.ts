import { describe, expect, it } from 'vitest'
import {
  CODE_EXTENSIONS,
  hasExtension,
  isBinary,
  isGovernedCode,
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

  it('reports a NUL byte, which no text encoding produces', () => {
    expect(isBinary(new Uint8Array([0x50, 0x4e, 0x47, 0x00, 0x1a]))).toBe(true)
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
