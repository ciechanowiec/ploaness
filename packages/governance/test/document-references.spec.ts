import { describe, expect, it } from 'vitest'
import {
  type DocumentViolation,
  findDocumentReferenceViolations,
} from '../src/document-references.js'

// A real (not mocked) isExistingFile backed by a set of known paths - the pure core takes it as a value,
// which is exactly why no test double is needed (see AGENTS.md "no mocks").
const existenceCheckOver =
  (paths: readonly string[]) =>
  (candidate: string): boolean =>
    paths.includes(candidate)

const scripts: ReadonlySet<string> = new Set<string>(['verify', 'lint:arch', 'test:int'])

const run = (
  markdown: string,
  existingFiles: readonly string[] = [],
): readonly DocumentViolation[] =>
  findDocumentReferenceViolations({
    markdown,
    scriptNames: scripts,
    isExistingFile: existenceCheckOver(existingFiles),
    reservedWords: new Set<string>(),
  })

describe('findDocumentReferenceViolations - scripts', () => {
  it('accepts a backticked script token that exists in package.json', () => {
    expect(run('Run `lint:arch` constantly.')).toEqual([])
  })

  it('flags a backticked script token that is absent from package.json', () => {
    const violations: readonly DocumentViolation[] = run('We renamed it to `lint:archaeology`.')
    expect(violations).toEqual([
      {
        reference: 'lint:archaeology',
        kind: 'script',
        reason: 'no matching script in package.json',
      },
    ])
  })

  it('flags a `pnpm run <name>` invocation whose script does not exist', () => {
    const violations: readonly DocumentViolation[] = run('Just `pnpm run deploy` it.')
    expect(violations).toHaveLength(1)
    expect(violations[0]?.reference).toBe('deploy')
  })

  it('accepts a `pnpm run <name>` invocation whose script exists', () => {
    expect(run('Run `pnpm run verify` before pushing.')).toEqual([])
  })

  it('ignores backticked prose that is not a script token', () => {
    expect(run('The `req` object and `Where` filter.')).toEqual([])
  })
})

describe('findDocumentReferenceViolations - paths', () => {
  it('accepts a full-path file that exists', () => {
    expect(
      run('See `scripts/check-documentation.ts`.', ['scripts/check-documentation.ts']),
    ).toEqual([])
  })

  it('flags a full-path file that does not exist', () => {
    const violations: readonly DocumentViolation[] = run('See `scripts/gone.ts`.', [])
    expect(violations).toEqual([
      { reference: 'scripts/gone.ts', kind: 'path', reason: 'referenced file does not exist' },
    ])
  })

  it('checks the base directory of a trailing glob path (and ignores it when extensionless)', () => {
    // `src/access/**` strips to `src/access`, which has no extension, so it is not existence-checked.
    expect(run('Helpers live in `src/access/**`.', [])).toEqual([])
  })

  it('ignores a directory reference that has no file extension', () => {
    // The documented "no migrations yet" case must NOT be flagged as a missing path.
    expect(run('The repo has no `src/migrations` yet.', [])).toEqual([])
  })

  it('ignores a bare filename with no directory (shorthand reference)', () => {
    expect(run('Bootstrap lives in `payload.config.ts`.', [])).toEqual([])
  })

  it('ignores a glob with a non-trailing wildcard it cannot resolve', () => {
    expect(run('Plugins match `plugins/*.grit`.', [])).toEqual([])
  })
})

describe('reserved words', () => {
  it('does not flag a word that names a gate rather than a script', () => {
    const found: readonly DocumentViolation[] = findDocumentReferenceViolations({
      markdown: 'The `knip` gate reports dead code.',
      scriptNames: new Set<string>(),
      isExistingFile: () => true,
      reservedWords: new Set(['knip']),
    })
    expect(found).toEqual([])
  })

  it('still flags the same word when it is not reserved', () => {
    const found: readonly DocumentViolation[] = findDocumentReferenceViolations({
      markdown: 'Run `knip` to find dead code.',
      scriptNames: new Set<string>(),
      isExistingFile: () => true,
      reservedWords: new Set<string>(),
    })
    expect(found).toHaveLength(1)
  })
})
