import { describe, expect, it } from 'vitest'
import {
  isSupportedImagePath,
  SUPPORTED_IMAGE_EXTENSIONS,
  validateImageBytes,
} from '../src/image-assets.js'

// Buffer.from is used rather than Uint8Array.fromBase64, which is not in this project's TS lib target.
const fromBase64 = (base64: string): Buffer => Buffer.from(base64, 'base64')

// A real, valid 1x1 transparent PNG and the ORIGINAL corrupt one (valid header, truncated IDAT stream).
const VALID_PNG: Buffer = fromBase64(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1Jr' +
    'AAAADUlEQVQImWNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==',
)
const CORRUPT_PNG: Buffer = fromBase64(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
)

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values)
const ascii = (text: string): Uint8Array => new TextEncoder().encode(text)
const concat = (...parts: Uint8Array[]): Uint8Array =>
  new Uint8Array(parts.flatMap((part) => [...part]))

// Build a PNG chunk (length, type, data, CRC); the validator ignores CRC, so it is left zero.
const pngChunk = (type: string, data: Uint8Array): Uint8Array => {
  const length: Uint8Array<ArrayBuffer> = new Uint8Array(4)
  new DataView(length.buffer).setUint32(0, data.length)
  return concat(length, ascii(type), data, bytes(0, 0, 0, 0))
}
const PNG_SIG: Uint8Array = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

interface IcoShape {
  readonly length: number
  readonly count: number
  readonly size: number
  readonly offset: number
  readonly type?: number
}

const ico = (shape: IcoShape): Uint8Array => {
  const buffer: Uint8Array<ArrayBuffer> = new Uint8Array(shape.length)
  const view: DataView<ArrayBuffer> = new DataView<ArrayBuffer>(buffer.buffer)
  view.setUint16(2, shape.type ?? 1, true)
  view.setUint16(4, shape.count, true)
  if (shape.length >= 22) {
    view.setUint32(6 + 8, shape.size, true)
    view.setUint32(6 + 12, shape.offset, true)
  }
  return buffer
}

describe('validateImageBytes - PNG (real zlib decode)', () => {
  it('accepts a valid PNG', () => {
    expect(validateImageBytes('logo.png', VALID_PNG)).toBeNull()
  })

  it('rejects the real-world corrupt PNG that caused the original bug', () => {
    // The bytes that shipped and rendered as "Image corrupt or truncated": whichever structural or
    // inflate defect the decoder hits first, the gate must reject it (a non-null reason).
    expect(validateImageBytes('logo.png', CORRUPT_PNG)).not.toBeNull()
  })

  it('rejects a structurally valid PNG whose IDAT is not a valid zlib stream', () => {
    const badZlib: Uint8Array = concat(
      PNG_SIG,
      pngChunk('IHDR', new Uint8Array(13)),
      pngChunk('IDAT', bytes(0x00, 0x00, 0x00, 0x00)),
      pngChunk('IEND', bytes()),
    )
    expect(validateImageBytes('x.png', badZlib)).toBe('corrupt PNG (image data failed to inflate)')
  })

  it('rejects a bad PNG signature', () => {
    expect(validateImageBytes('x.png', bytes(0, 1, 2, 3, 4, 5, 6, 7, 8))).toBe(
      'not a valid PNG (bad signature)',
    )
  })

  it('rejects a PNG missing its IEND chunk', () => {
    const noIend: Uint8Array = concat(
      PNG_SIG,
      pngChunk('IHDR', new Uint8Array(13)),
      pngChunk('IDAT', bytes(1, 2, 3)),
    )
    expect(validateImageBytes('x.png', noIend)).toBe('truncated PNG (no IEND chunk)')
  })

  it('rejects a PNG whose chunk length runs past the end of file', () => {
    const declaredLength: Uint8Array<ArrayBuffer> = new Uint8Array(4)
    new DataView(declaredLength.buffer).setUint32(0, 100)
    const overrun: Uint8Array = concat(PNG_SIG, declaredLength, ascii('IDAT'), new Uint8Array(8))
    expect(validateImageBytes('x.png', overrun)).toContain('runs past end of file')
  })

  it('rejects a PNG with no IDAT image data', () => {
    const noIdat: Uint8Array = concat(
      PNG_SIG,
      pngChunk('IHDR', new Uint8Array(13)),
      pngChunk('IEND', bytes()),
    )
    expect(validateImageBytes('x.png', noIdat)).toBe('invalid PNG (no IDAT image data)')
  })
})

describe('validateImageBytes - JPEG / GIF / WebP', () => {
  it('accepts and rejects JPEG by its SOI/EOI markers', () => {
    expect(validateImageBytes('a.jpg', bytes(0xff, 0xd8, 0xff, 0xd9))).toBeNull()
    expect(validateImageBytes('a.jpeg', bytes(0x00, 0x00, 0xff, 0xd9))).toBe(
      'not a valid JPEG (bad SOI marker)',
    )
    expect(validateImageBytes('a.jpg', bytes(0xff, 0xd8, 0x12, 0x34))).toBe(
      'truncated JPEG (missing EOI marker)',
    )
  })

  it('accepts and rejects GIF by its header and trailer', () => {
    const wellFormed: Uint8Array = concat(ascii('GIF89a'), bytes(0x00, 0x3b))
    const badHeader: Uint8Array = concat(ascii('XXXXXX'), bytes(0x3b))
    const noTrailer: Uint8Array = concat(ascii('GIF89a'), bytes(0x00))
    expect(validateImageBytes('a.gif', wellFormed)).toBeNull()
    expect(validateImageBytes('a.gif', badHeader)).toBe('not a valid GIF (bad header)')
    expect(validateImageBytes('a.gif', noTrailer)).toBe('truncated GIF (missing trailer byte)')
  })

  it('accepts and rejects WebP by its RIFF/WEBP header and size', () => {
    const declaredSize: Uint8Array = bytes(4, 0, 0, 0)
    const oversizedDeclaration: Uint8Array = bytes(0xff, 0xff, 0xff, 0xff)
    const wellFormed: Uint8Array = concat(ascii('RIFF'), declaredSize, ascii('WEBP'))
    const badTag: Uint8Array = concat(ascii('XXXX'), declaredSize, ascii('WEBP'))
    const oversized: Uint8Array = concat(ascii('RIFF'), oversizedDeclaration, ascii('WEBP'))
    expect(validateImageBytes('a.webp', wellFormed)).toBeNull()
    expect(validateImageBytes('a.webp', badTag)).toBe('not a valid WebP (bad RIFF/WEBP header)')
    expect(validateImageBytes('a.webp', oversized)).toBe(
      'truncated WebP (RIFF size exceeds file length)',
    )
  })
})

describe('validateImageBytes - ICO', () => {
  it('accepts a well-formed ICO', () => {
    expect(
      validateImageBytes('favicon.ico', ico({ length: 22, count: 1, size: 0, offset: 22 })),
    ).toBeNull()
  })

  it('rejects a bad ICO header', () => {
    expect(
      validateImageBytes(
        'favicon.ico',
        ico({ length: 22, type: 2, count: 1, size: 0, offset: 22 }),
      ),
    ).toBe('not a valid ICO (bad header)')
  })

  it('rejects an ICO with no entries', () => {
    expect(
      validateImageBytes('favicon.ico', ico({ length: 6, count: 0, size: 0, offset: 0 })),
    ).toBe('invalid ICO (no image entries)')
  })

  it('rejects an ICO whose directory runs past the file', () => {
    expect(
      validateImageBytes('favicon.ico', ico({ length: 10, count: 1, size: 0, offset: 0 })),
    ).toBe('truncated ICO (directory runs past end of file)')
  })

  it('rejects an ICO whose image data runs past the file', () => {
    expect(
      validateImageBytes('favicon.ico', ico({ length: 22, count: 1, size: 100, offset: 22 })),
    ).toBe('truncated ICO (image data runs past end of file)')
  })
})

describe('validateImageBytes - dispatch and support', () => {
  it('returns null for an extension the gate does not validate', () => {
    expect(validateImageBytes('notes.txt', bytes(1, 2, 3))).toBeNull()
  })

  it('flags an empty image file', () => {
    expect(validateImageBytes('logo.png', new Uint8Array(0))).toBe('empty file')
  })

  it('matches the extension case-insensitively', () => {
    expect(validateImageBytes('LOGO.PNG', VALID_PNG)).toBeNull()
  })
})

describe('isSupportedImagePath / SUPPORTED_IMAGE_EXTENSIONS', () => {
  it('recognizes supported image extensions, case-insensitively, and rejects others', () => {
    expect(isSupportedImagePath('public/logo.png')).toBe(true)
    expect(isSupportedImagePath('a/b/icon.ICO')).toBe(true)
    expect(isSupportedImagePath('photo.JPEG')).toBe(true)
    expect(isSupportedImagePath('readme.md')).toBe(false)
    expect(isSupportedImagePath('Makefile')).toBe(false)
  })

  it('exposes every validated extension', () => {
    expect(new Set(SUPPORTED_IMAGE_EXTENSIONS)).toEqual(
      new Set(['gif', 'ico', 'jpeg', 'jpg', 'png', 'webp']),
    )
  })
})
