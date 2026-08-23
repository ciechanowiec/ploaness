import { describe, expect, it } from 'vitest'
import { isNonTrivial, parseMessage, parseNumstat, validateMessage } from '../src/commit-message.js'

const ELLIPSIS = String.fromCodePoint(0x2026)
const SCISSORS = '# ------------------------ >8 ------------------------'

describe('parseMessage', () => {
  it('extracts header and body, dropping git comment lines', () => {
    const parsed = parseMessage('feat(x): do a real thing\n\nBecause reasons.\n# a git comment')
    expect(parsed).toEqual({ header: 'feat(x): do a real thing', body: 'Because reasons.' })
  })

  it('ignores the verbose-diff section below the scissors marker', () => {
    const raw = `fix: something real here\n\nWhy it matters.\n${SCISSORS}\ndiff --git a b`
    expect(parseMessage(raw).body).toBe('Why it matters.')
  })

  it('returns empty header and body when there is no content', () => {
    expect(parseMessage('# only comments\n#more')).toEqual({ header: '', body: '' })
  })

  it('handles a header with no body', () => {
    expect(parseMessage('docs: update the readme file')).toEqual({
      header: 'docs: update the readme file',
      body: '',
    })
  })
})

describe('validateMessage', () => {
  const good = 'feat(template): add the commit message gate'

  it('accepts a well-formed trivial commit', () => {
    expect(validateMessage({ header: good, body: '' }, false)).toEqual([])
  })

  it.each([
    ['git-generated merge', 'Merge branch main into topic'],
    ['git-generated revert', 'Revert "feat: earlier change"'],
    ['autosquash', 'fixup! feat: earlier change'],
  ])('rejects a %s subject', (_kind, header) => {
    const problems = validateMessage({ header, body: '' }, true)
    expect(problems.some((problem) => problem.includes('invalid header'))).toBe(true)
  })

  it('holds a dependency-bump subject to the body and length rules', () => {
    const header = 'build(deps): bump @typescript-eslint/eslint-plugin to 8.62.0 in the lint group'
    const problems = validateMessage({ header, body: '' }, true)
    expect(problems.some((problem) => problem.includes('chars'))).toBe(true)
    expect(problems.some((problem) => problem.includes('explaining WHY'))).toBe(true)
  })

  it('accepts a hand-written revert that uses the revert type', () => {
    expect(
      validateMessage(
        { header: 'revert: restore the previous gate', body: 'The bump broke the build.' },
        true,
      ),
    ).toEqual([])
  })

  it('rejects a non-conventional header', () => {
    const problems = validateMessage({ header: 'add some stuff to the repo', body: '' }, false)
    expect(problems.some((problem) => problem.includes('invalid header'))).toBe(true)
  })

  it('rejects an over-long header', () => {
    const header = `feat(template): ${'x'.repeat(80)}`
    expect(validateMessage({ header, body: '' }, false).some((p) => p.includes('chars'))).toBe(true)
  })

  it('rejects a trailing period', () => {
    const problems = validateMessage({ header: 'feat: add the new commit gate.', body: '' }, false)
    expect(problems.some((problem) => problem.includes('period'))).toBe(true)
  })

  it('rejects a too-short description', () => {
    const problems = validateMessage({ header: 'fix: tweak', body: '' }, false)
    expect(problems.some((problem) => problem.includes('too short'))).toBe(true)
  })

  it('rejects a low-effort junk description', () => {
    const problems = validateMessage({ header: 'chore: wip on the thing', body: '' }, false)
    expect(problems.some((problem) => problem.includes('low-effort'))).toBe(true)
  })

  it('flags banned typography in the message', () => {
    const problems = validateMessage(
      { header: `feat: tidy the gate ${ELLIPSIS} soon`, body: '' },
      false,
    )
    expect(problems.some((problem) => problem.includes('banned'))).toBe(true)
  })

  it('flags a commit that attributes the change to an AI agent', () => {
    const problems = validateMessage(
      { header: good, body: 'Co-Authored-By: Claude <noreply@anthropic.com>' },
      false,
    )
    expect(problems.some((problem) => problem.includes('references an AI agent'))).toBe(true)
  })

  it('flags an agent session identifier in the body', () => {
    const problems = validateMessage({ header: good, body: 'Claude-Session: abc-123' }, false)
    expect(problems.some((problem) => problem.includes('session'))).toBe(true)
  })

  it('accepts a commit that only mentions an agent tool in prose', () => {
    expect(
      validateMessage(
        { header: 'docs: document the claude code skill', body: 'Explains skill loading.' },
        true,
      ),
    ).toEqual([])
  })

  it('requires a body for non-trivial changes', () => {
    const problems = validateMessage({ header: good, body: '' }, true)
    expect(problems.some((problem) => problem.includes('explaining WHY'))).toBe(true)
  })

  it('accepts a non-trivial change that carries a body', () => {
    expect(validateMessage({ header: good, body: 'Explains the reasoning.' }, true)).toEqual([])
  })
})

describe('parseNumstat', () => {
  it('sums added and deleted lines across files', () => {
    expect(parseNumstat('5\t3\ta.ts\n2\t0\tb.ts')).toEqual({ files: 2, lines: 10 })
  })

  it('counts binary (-) rows as zero lines', () => {
    expect(parseNumstat('-\t-\timage.png')).toEqual({ files: 1, lines: 0 })
  })

  it('treats a malformed row missing a column as zero for that column', () => {
    expect(parseNumstat('5')).toEqual({ files: 1, lines: 5 })
  })

  it('returns zero counts for empty output', () => {
    expect(parseNumstat('')).toEqual({ files: 0, lines: 0 })
  })
})

describe('isNonTrivial', () => {
  it('is true when more than 2 files change', () => {
    expect(isNonTrivial({ files: 3, lines: 1 })).toBe(true)
  })

  it('is true when more than 50 lines change', () => {
    expect(isNonTrivial({ files: 1, lines: 51 })).toBe(true)
  })

  it('is false at or below both thresholds', () => {
    expect(isNonTrivial({ files: 2, lines: 50 })).toBe(false)
  })
})
