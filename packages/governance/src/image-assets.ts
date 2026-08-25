// Image-asset integrity policy: the pure, unit-tested logic behind the repo-wide gate
// (`image-assets`, in packages/cli/src/checks/integrity.ts). Given the bytes of a
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

// The PNG signature, written as the byte string the format specification defines rather than as eight
// bare numbers: a high bit, "PNG", then a CRLF/EOF/LF run that detects a transfer which mangled line
// endings. Spelling it this way makes the bytes readable and leaves no unexplained number behind.
const PNG_SIGNATURE_BYTES: string = '\u{89}PNG\r\n\u{1A}\n'
const PNG_SIGNATURE: readonly number[] = Array.from(
  PNG_SIGNATURE_BYTES,
  (character: string): number => character.codePointAt(0) ?? 0,
)
const PNG_HEADER_BYTES: number = 8
// Every chunk carries a 4-byte length, a 4-byte type, and a 4-byte CRC around its payload.
const CHUNK_LENGTH_BYTES: number = 4
const CHUNK_TYPE_BYTES: number = 4
const CHUNK_CRC_BYTES: number = 4
const CHUNK_OVERHEAD_BYTES: number = CHUNK_LENGTH_BYTES + CHUNK_TYPE_BYTES + CHUNK_CRC_BYTES
// The payload begins after the length and the type.
const CHUNK_PAYLOAD_OFFSET: number = CHUNK_LENGTH_BYTES + CHUNK_TYPE_BYTES

const hasPngSignature = (bytes: Uint8Array): boolean =>
  PNG_SIGNATURE.every((byte: number, index: number): boolean => bytes[index] === byte)

interface PngChunkWalk {
  readonly parts: readonly Uint8Array[]
  readonly error: string | null
}

// Walk the PNG chunk stream from the end of the signature, collecting IDAT payloads and stopping at
// IEND. Any chunk whose declared length runs past the file, or a missing IEND, means a truncated image.
const walkPngChunks = (bytes: Uint8Array, view: DataView): PngChunkWalk => {
  /* eslint-disable functional/no-let -- a PNG can carry thousands of chunks, so recursion would risk
     the stack; the cursor and the payloads it collects escape only as the returned value */
  let parts: readonly Uint8Array[] = []
  let offset: number = PNG_HEADER_BYTES
  /* eslint-enable functional/no-let -- the walk above is the only place this file mutates */
  while (offset + CHUNK_OVERHEAD_BYTES <= bytes.length) {
    const length: number = view.getUint32(offset)
    const type: string = asciiSlice(
      bytes,
      offset + CHUNK_LENGTH_BYTES,
      offset + CHUNK_PAYLOAD_OFFSET,
    )
    const dataEnd: number = offset + CHUNK_PAYLOAD_OFFSET + length
    if (dataEnd + CHUNK_CRC_BYTES > bytes.length) {
      return { parts, error: `truncated PNG (chunk "${type}" runs past end of file)` }
    }
    if (type === 'IDAT') {
      parts = [...parts, bytes.subarray(offset + CHUNK_PAYLOAD_OFFSET, dataEnd)]
    } else if (type === 'IEND') {
      return { parts, error: null }
    }
    offset = dataEnd + CHUNK_CRC_BYTES
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

// JPEG brackets its data with a start-of-image and an end-of-image marker, each two bytes.
const JPEG_MARKER_PREFIX: number = 0xff
const JPEG_START_OF_IMAGE: number = 0xd8
const JPEG_END_OF_IMAGE: number = 0xd9
const JPEG_MARKER_BYTES: number = 2
// A JPEG must carry at least its start-of-image and end-of-image markers.
const JPEG_MARKER_COUNT: number = 2
const JPEG_MINIMUM_BYTES: number = JPEG_MARKER_BYTES * JPEG_MARKER_COUNT
const SECOND_BYTE: number = 1
const LAST_BYTE: number = -1
const SECOND_TO_LAST_BYTE: number = -2

const validateJpeg = (bytes: Uint8Array): string | null => {
  if (
    bytes.length < JPEG_MINIMUM_BYTES ||
    bytes[0] !== JPEG_MARKER_PREFIX ||
    bytes[SECOND_BYTE] !== JPEG_START_OF_IMAGE
  ) {
    return 'not a valid JPEG (bad SOI marker)'
  }
  if (
    bytes.at(SECOND_TO_LAST_BYTE) !== JPEG_MARKER_PREFIX ||
    bytes.at(LAST_BYTE) !== JPEG_END_OF_IMAGE
  ) {
    return 'truncated JPEG (missing EOI marker)'
  }
  return null
}

const GIF_HEADER_BYTES: number = 6
const GIF_TRAILER: number = 0x3b

const validateGif = (bytes: Uint8Array): string | null => {
  const header: string = asciiSlice(bytes, 0, GIF_HEADER_BYTES)
  if (header !== 'GIF87a' && header !== 'GIF89a') {
    return 'not a valid GIF (bad header)'
  }
  if (bytes.at(LAST_BYTE) !== GIF_TRAILER) {
    return 'truncated GIF (missing trailer byte)'
  }
  return null
}

// A WebP file is a RIFF container: the tag, a 32-bit size, then the form type.
const RIFF_TAG_BYTES: number = 4
const RIFF_SIZE_OFFSET: number = RIFF_TAG_BYTES
const RIFF_FORM_OFFSET: number = 8
const WEBP_HEADER_BYTES: number = 12
// The declared size counts everything after the tag and the size field itself.
const RIFF_SIZE_EXCLUDES_BYTES: number = 8

const validateWebp = (bytes: Uint8Array): string | null => {
  if (
    bytes.length < WEBP_HEADER_BYTES ||
    asciiSlice(bytes, 0, RIFF_TAG_BYTES) !== 'RIFF' ||
    asciiSlice(bytes, RIFF_FORM_OFFSET, WEBP_HEADER_BYTES) !== 'WEBP'
  ) {
    return 'not a valid WebP (bad RIFF/WEBP header)'
  }
  const declaredLength: number =
    dataView(bytes).getUint32(RIFF_SIZE_OFFSET, true) + RIFF_SIZE_EXCLUDES_BYTES
  if (declaredLength > bytes.length) {
    return 'truncated WebP (RIFF size exceeds file length)'
  }
  return null
}

const ICO_HEADER_BYTES: number = 6
const ICO_DIR_ENTRY_BYTES: number = 16
// Within a directory entry: the payload size, then the offset the payload begins at.
const ICO_ENTRY_SIZE_OFFSET: number = 8
const ICO_ENTRY_DATA_OFFSET: number = 12
// The ICO header is a zero reserved field, an image type of 1, then the entry count.
const ICO_RESERVED_OFFSET: number = 0
const ICO_TYPE_OFFSET: number = 2
const ICO_COUNT_OFFSET: number = 4
const ICO_ICON_TYPE: number = 1

const validateIcoEntries = (bytes: Uint8Array, view: DataView, count: number): string | null => {
  const entryIndexes: readonly number[] = Array.from(
    { length: count },
    (_: unknown, at: number): number => at,
  )
  for (const index of entryIndexes) {
    const entry: number = ICO_HEADER_BYTES + index * ICO_DIR_ENTRY_BYTES
    if (entry + ICO_DIR_ENTRY_BYTES > bytes.length) {
      return 'truncated ICO (directory runs past end of file)'
    }
    const imageSize: number = view.getUint32(entry + ICO_ENTRY_SIZE_OFFSET, true)
    const imageOffset: number = view.getUint32(entry + ICO_ENTRY_DATA_OFFSET, true)
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
    view.getUint16(ICO_RESERVED_OFFSET, true) !== 0 ||
    view.getUint16(ICO_TYPE_OFFSET, true) !== ICO_ICON_TYPE
  ) {
    return 'not a valid ICO (bad header)'
  }
  const count: number = view.getUint16(ICO_COUNT_OFFSET, true)
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
