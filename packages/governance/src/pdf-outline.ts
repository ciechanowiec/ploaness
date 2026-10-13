// Read the page each bookmark of a Chromium-printed PDF points at. The browser cannot number a table of
// contents while it paginates, so the report is printed once, its bookmarks are read here, and the
// numbers are written into the contents before the final print. Only the uncompressed object syntax
// Chromium writes is read; anything else yields no numbers rather than wrong ones.

const OBJECT_HEADER: RegExp = /(\d{1,10}) 0 obj\b/u
const KIDS: RegExp = /\/Kids\s*\[([^\]]*)\]/u
const REFERENCE: RegExp = /(\d{1,10}) 0 R\b/gu
const CATALOG: RegExp = /\/Type\s{0,4}\/Catalog\b/u
const PAGES_ROOT: RegExp = /\/Pages\s{1,4}(\d{1,10}) 0 R/u
const TITLE: RegExp = /\/Title\s*(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)/u
const DESTINATION: RegExp = /\/Dest\s{0,4}\[\s{0,4}(\d{1,10}) 0 R/u
const OCTAL: RegExp = /^[0-7]{1,3}/u
const ESCAPES: Readonly<Record<string, string>> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }
const HEX_RADIX: number = 16
const OCTAL_RADIX: number = 8
const UTF16_UNIT: number = 4
const BOM: string = 'FEFF'

// Each object runs to its `endobj`. Its dictionary is what precedes any stream, which keeps the binary
// stream data out of every pattern below.
const objectsOf = (pdf: string): ReadonlyMap<string, string> =>
  new Map(
    pdf.split('endobj').flatMap((chunk: string): readonly (readonly [string, string])[] => {
      const header: RegExpExecArray | null = OBJECT_HEADER.exec(chunk)
      if (header === null) {
        return []
      }
      const body: string = chunk.slice(header.index + header[0].length)
      const stream: number = body.indexOf('stream')
      return [[header[1] ?? '', stream === -1 ? body : body.slice(0, stream)]]
    }),
  )

const referencesIn = (text: string): readonly string[] =>
  [...text.matchAll(REFERENCE)].map((match: RegExpExecArray): string => match[1] ?? '')

// A page-tree node lists its kids; a kid without kids of its own is a page. Depth-first order is page order.
const pagesUnder = (
  node: string,
  objects: ReadonlyMap<string, string>,
  seen: ReadonlySet<string>,
): readonly string[] => {
  const kids: string | undefined = KIDS.exec(objects.get(node) ?? '')?.[1]
  if (kids === undefined || seen.has(node)) {
    return [node]
  }
  const visited: ReadonlySet<string> = new Set([...seen, node])
  return referencesIn(kids).flatMap((kid: string): readonly string[] => pagesUnder(kid, objects, visited))
}

const literalString = (body: string): string =>
  body.replaceAll(/\\([0-7]{1,3}|[\s\S])/gu, (_whole: string, escaped: string): string =>
    OCTAL.test(escaped) ? String.fromCodePoint(Number.parseInt(escaped, OCTAL_RADIX)) : (ESCAPES[escaped] ?? escaped),
  )

const hexString = (body: string): string => {
  const hex: string = body.replaceAll(/\s/gu, '').toUpperCase()
  const units: string = hex.startsWith(BOM) ? hex.slice(BOM.length) : hex
  return Array.from({ length: Math.floor(units.length / UTF16_UNIT) }, (_unused: unknown, index: number): string =>
    String.fromCodePoint(Number.parseInt(units.slice(index * UTF16_UNIT, (index + 1) * UTF16_UNIT), HEX_RADIX)),
  ).join('')
}

const decodeTitle = (raw: string): string =>
  raw.startsWith('(') ? literalString(raw.slice(1, -1)) : hexString(raw.slice(1, -1))

/**
 * Map each bookmark title of a PDF to the page it points at.
 * @param pdf the PDF bytes, read as Latin-1 text.
 * @returns the 1-based page number by bookmark title; empty when the structure is not recognised.
 */
export const outlinePages = (pdf: string): ReadonlyMap<string, number> => {
  const objects: ReadonlyMap<string, string> = objectsOf(pdf)
  const root: string | undefined = [...objects.values()]
    .map((body: string): string | undefined => (CATALOG.test(body) ? PAGES_ROOT.exec(body)?.[1] : undefined))
    .find((found: string | undefined): found is string => found !== undefined)
  if (root === undefined) {
    return new Map()
  }
  const order: ReadonlyMap<string, number> = new Map(
    pagesUnder(root, objects, new Set()).map((page: string, index: number): readonly [string, number] => [
      page,
      index + 1,
    ]),
  )
  return new Map(
    [...objects.values()].flatMap((body: string): readonly (readonly [string, number])[] => {
      const title: string | undefined = TITLE.exec(body)?.[1]
      const page: number | undefined = order.get(DESTINATION.exec(body)?.[1] ?? '')
      return title === undefined || page === undefined ? [] : [[decodeTitle(title), page]]
    }),
  )
}
