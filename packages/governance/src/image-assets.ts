// Image-asset integrity policy: the pure, unit-tested logic behind the repo-wide gate
// (check-image-assets.ts, run via `pnpm run lint:image-assets`, part of `verify`). Given the bytes of a
// tracked image, it reports whether the image is structurally broken - corrupt or truncated - so a
// committed asset that will not render cannot ship. This is the class of defect that a 200 response and
// a passing a11y sweep both miss: the original failure was a seeded PNG whose header parsed but whose
// compressed image data was truncated, so it served fine yet rendered as "Image corrupt or truncated".
//
// PNG (the format that broke, and the one the CMS stores) gets a REAL decode: its IDAT stream is fully
// inflated with zlib, which throws exactly on that truncation. The other formats get a structural
// signature-and-trailer check that catches truncation cheaply and dependency-free.
import { inflateSync } from 'node:zlib'

const LATIN1: TextDecoder = new TextDecoder('latin1')

const dataView = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

// Read a run of bytes as a Latin-1 string (each byte maps 1:1 to a code point), for magic-number headers.
const asciiSlice = (bytes: Uint8Array, start: number, end: number): string =>
  LATIN1.decode(bytes.subarray(start, end))

const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PNG_HEADER_BYTES: number = 8
const CHUNK_OVERHEAD_BYTES: number = 12 // 4 length + 4 type + 4 CRC.

const hasPngSignature = (bytes: Uint8Array): boolean =>
  PNG_SIGNATURE.every((byte: number, index: number): boolean => bytes[index] === byte)

interface PngChunkWalk {
  readonly parts: readonly Uint8Array[]
  readonly error: string | null
}

// Walk the PNG chunk stream from the end of the signature, collecting IDAT payloads and stopping at
// IEND. Any chunk whose declared length runs past the file, or a missing IEND, means a truncated image.
const walkPngChunks = (bytes: Uint8Array, view: DataView): PngChunkWalk => {
  const parts: Uint8Array[] = []
  let offset: number = PNG_HEADER_BYTES
  while (offset + CHUNK_OVERHEAD_BYTES <= bytes.length) {
    const length: number = view.getUint32(offset)
    const type: string = asciiSlice(bytes, offset + 4, offset + 8)
    const dataEnd: number = offset + 8 + length
    if (dataEnd + 4 > bytes.length) {
      return { parts, error: `truncated PNG (chunk "${type}" runs past end of file)` }
    }
    if (type === 'IDAT') {
      parts.push(bytes.subarray(offset + 8, dataEnd))
    } else if (type === 'IEND') {
      return { parts, error: null }
    }
    offset = dataEnd + 4
  }
  return { parts, error: 'truncated PNG (no IEND chunk)' }
}

const inflatePng = (parts: readonly Uint8Array[]): string | null => {
  try {
    inflateSync(Buffer.concat([...parts]))
    return null
  } catch {
    return 'corrupt PNG (image data failed to inflate)'
  }
}

const validatePng = (bytes: Uint8Array): string | null => {
  if (bytes.length < PNG_HEADER_BYTES || !hasPngSignature(bytes)) {
    return 'not a valid PNG (bad signature)'
  }
  const walk: PngChunkWalk = walkPngChunks(bytes, dataView(bytes))
  if (walk.error !== null) {
    return walk.error
  }
  if (walk.parts.length === 0) {
    return 'invalid PNG (no IDAT image data)'
  }
  return inflatePng(walk.parts)
}

const validateJpeg = (bytes: Uint8Array): string | null => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return 'not a valid JPEG (bad SOI marker)'
  }
  if (bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
    return 'truncated JPEG (missing EOI marker)'
  }
  return null
}

const validateGif = (bytes: Uint8Array): string | null => {
  const header: string = asciiSlice(bytes, 0, 6)
  if (header !== 'GIF87a' && header !== 'GIF89a') {
    return 'not a valid GIF (bad header)'
  }
  if (bytes.at(-1) !== 0x3b) {
    return 'truncated GIF (missing trailer byte)'
  }
  return null
}

const validateWebp = (bytes: Uint8Array): string | null => {
  if (
    bytes.length < 12 ||
    asciiSlice(bytes, 0, 4) !== 'RIFF' ||
    asciiSlice(bytes, 8, 12) !== 'WEBP'
  ) {
    return 'not a valid WebP (bad RIFF/WEBP header)'
  }
  const declaredLength: number = dataView(bytes).getUint32(4, true) + 8
  if (declaredLength > bytes.length) {
    return 'truncated WebP (RIFF size exceeds file length)'
  }
  return null
}

const ICO_HEADER_BYTES: number = 6
const ICO_DIR_ENTRY_BYTES: number = 16

const validateIcoEntries = (bytes: Uint8Array, view: DataView, count: number): string | null => {
  for (let index: number = 0; index < count; index += 1) {
    const entry: number = ICO_HEADER_BYTES + index * ICO_DIR_ENTRY_BYTES
    if (entry + ICO_DIR_ENTRY_BYTES > bytes.length) {
      return 'truncated ICO (directory runs past end of file)'
    }
    const imageSize: number = view.getUint32(entry + 8, true)
    const imageOffset: number = view.getUint32(entry + 12, true)
    if (imageOffset + imageSize > bytes.length) {
      return 'truncated ICO (image data runs past end of file)'
    }
  }
  return null
}

const validateIco = (bytes: Uint8Array): string | null => {
  const view: DataView = dataView(bytes)
  if (
    bytes.length < ICO_HEADER_BYTES ||
    view.getUint16(0, true) !== 0 ||
    view.getUint16(2, true) !== 1
  ) {
    return 'not a valid ICO (bad header)'
  }
  const count: number = view.getUint16(4, true)
  if (count === 0) {
    return 'invalid ICO (no image entries)'
  }
  return validateIcoEntries(bytes, view, count)
}

// The image extensions this gate understands, each mapped to its byte validator. A tracked file with any
// other extension is not an image this gate checks.
const VALIDATORS: Readonly<Record<string, (bytes: Uint8Array) => string | null>> = {
  png: validatePng,
  jpg: validateJpeg,
  jpeg: validateJpeg,
  gif: validateGif,
  webp: validateWebp,
  ico: validateIco,
}

/** The lowercased file extensions the image-asset gate validates. */
export const SUPPORTED_IMAGE_EXTENSIONS: readonly string[] = Object.keys(VALIDATORS)

const extensionOf = (filePath: string): string => {
  const lastDot: number = filePath.lastIndexOf('.')
  return lastDot === -1 ? '' : filePath.slice(lastDot + 1).toLowerCase()
}

/** Whether a path is an image asset this gate validates (by extension). */
export const isSupportedImagePath = (filePath: string): boolean =>
  Object.hasOwn(VALIDATORS, extensionOf(filePath))

/**
 * Validate the bytes of one image, dispatched by the path's extension. Returns a human-readable reason
 * when the image is structurally broken (corrupt, truncated, or empty), or null when it is intact. A
 * path whose extension is not a supported image returns null (the caller filters to supported paths).
 * @param filePath the image's path, used only to pick the validator by extension.
 * @param bytes the raw file contents.
 * @returns the failure reason, or null when the image is intact.
 */
export const validateImageBytes = (filePath: string, bytes: Uint8Array): string | null => {
  const validator: ((bytes: Uint8Array) => string | null) | undefined =
    VALIDATORS[extensionOf(filePath)]
  if (validator === undefined) {
    return null
  }
  if (bytes.length === 0) {
    return 'empty file'
  }
  return validator(bytes)
}
