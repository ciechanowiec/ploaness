import { describe, expect, it } from 'vitest'
import {
  type ConfigReferenceViolation,
  extractLiteralSourcePaths,
  findMissingConfigReferences,
} from '../src/config-references.js'

// The pure core takes config text and a `fileExists` predicate as plain values, so a test feeds real
// strings with no test double (see AGENTS.md "no mocks").

const exists = (present: readonly string[]): ((relativePath: string) => boolean) => {
  const set: Set<string> = new Set<string>(present)
  return (relativePath: string): boolean => set.has(relativePath)
}

describe('extractLiteralSourcePaths', () => {
  it('extracts a plain quoted source path', () => {
    expect(extractLiteralSourcePaths('"src/lib/foo.ts"')).toEqual(['src/lib/foo.ts'])
  })

  it('strips a leading `!` negation (Biome)', () => {
    expect(extractLiteralSourcePaths("'!src/payload-generated-schema.ts'")).toEqual([
      'src/payload-generated-schema.ts',
    ])
  })

  it('accepts single, double, and backtick quotes', () => {
    const content = '\'src/a.ts\' "src/b.ts" `tests/c.tsx`'
    expect(extractLiteralSourcePaths(content)).toEqual(['src/a.ts', 'src/b.ts', 'tests/c.tsx'])
  })

  it('ignores glob patterns', () => {
    const content = '"src/**/*.tsx" "src/app/**" "scripts/**/*"'
    expect(extractLiteralSourcePaths(content)).toEqual([])
  })

  it('ignores dependency-cruiser path regexes', () => {
    const content = String.raw`"^src/(access|lib)/|^src/payload-types\.ts$"`
    expect(extractLiteralSourcePaths(content)).toEqual([])
  })

  it('ignores bare filenames and non-source directories', () => {
    const content = '"package.json" "next-env.d.ts" "node_modules/x.js" "dist/out.js"'
    expect(extractLiteralSourcePaths(content)).toEqual([])
  })

  it('deduplicates and sorts the results', () => {
    const content = '"src/b.ts" "src/a.ts" "!src/b.ts"'
    expect(extractLiteralSourcePaths(content)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('extracts the real-world carve-out that motivated the gate', () => {
    const biomeIncludes =
      '["src/**/*", "!src/payload-types.ts", "!src/payload-generated-schema.ts"]'
    expect(extractLiteralSourcePaths(biomeIncludes)).toEqual([
      'src/payload-generated-schema.ts',
      'src/payload-types.ts',
    ])
  })
})

describe('findMissingConfigReferences', () => {
  it('returns no violations when every path exists', () => {
    const found = findMissingConfigReferences(
      ['src/a.ts', 'src/b.ts'],
      exists(['src/a.ts', 'src/b.ts']),
    )
    expect(found).toEqual([])
  })

  it('flags a path that does not exist', () => {
    const found: readonly ConfigReferenceViolation[] = findMissingConfigReferences(
      ['src/present.ts', 'src/gone.ts'],
      exists(['src/present.ts']),
    )
    expect(found).toEqual([
      { path: 'src/gone.ts', reason: 'carved out of a tool config but the file does not exist' },
    ])
  })
})
