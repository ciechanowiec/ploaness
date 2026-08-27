import { describe, expect, it } from 'vitest'
import {
  type AssetHost,
  type AssetScope,
  type AssetState,
  type AssetViolation,
  applyManagedSection,
  checkAsset,
  findAssetViolations,
  type ManagedAsset,
  memberAssets,
  type ParsedManifest,
  parseManifest,
  readManagedSection,
  repositoryAssets,
  SECTION_BEGIN,
  SECTION_END,
  syncAction,
} from '../src/asset-policy.js'

const state = (overrides: Partial<AssetState> = {}): AssetState => ({
  isPresent: true,
  actual: 'body',
  expected: 'body',
  ...overrides,
})

describe('parseManifest', () => {
  it('reads entries and ignores comments and blank lines', () => {
    const parsed: ParsedManifest = parseManifest(
      '# a comment\n\nCLAUDE.md\tPINNED\tREPOSITORY\n.gitignore\tSEED\tREPOSITORY\n',
    )
    expect(parsed.assets).toEqual([
      { path: 'CLAUDE.md', disposition: 'PINNED', scope: 'REPOSITORY' },
      { path: '.gitignore', disposition: 'SEED', scope: 'REPOSITORY' },
    ])
    expect(parsed.problems).toEqual([])
  })

  // A managed file placed in the wrong half of a workspace is either demanded where it cannot be or
  // ignored where it must be. Neither should be reachable by leaving a column off or misspelling it.
  it.each([
    ['no scope at all', 'CLAUDE.md\tPINNED\n'],
    ['a scope it does not know', 'CLAUDE.md\tPINNED\tSOMEWHERE\n'],
  ])('refuses a row with %s', (_name: string, row: string) => {
    const parsed: ParsedManifest = parseManifest(row)
    expect(parsed.assets).toEqual([])
    expect(parsed.problems).toHaveLength(1)
  })

  it('reports a malformed row rather than dropping it silently', () => {
    const parsed: ParsedManifest = parseManifest('CLAUDE.md\tMAYBE\n')
    expect(parsed.assets).toEqual([])
    expect(parsed.problems).toHaveLength(1)
  })
})

describe('checkAsset', () => {
  const pinned: ManagedAsset = { path: 'CLAUDE.md', disposition: 'PINNED', scope: 'REPOSITORY' }
  const seed: ManagedAsset = { path: '.gitignore', disposition: 'SEED', scope: 'REPOSITORY' }
  const forbidden: ManagedAsset = {
    path: 'knip.json',
    disposition: 'FORBIDDEN',
    scope: 'REPOSITORY',
  }

  it('accepts a pinned file that matches', () => {
    expect(checkAsset(pinned, state())).toBeUndefined()
  })

  it('rejects a pinned file that drifted', () => {
    expect(checkAsset(pinned, state({ actual: 'edited' }))?.reason).toContain('drifted')
  })

  it('rejects a missing managed file', () => {
    expect(checkAsset(pinned, state({ isPresent: false, actual: undefined }))?.reason).toContain(
      'missing',
    )
  })

  it('accepts a seeded file the project has since edited', () => {
    expect(checkAsset(seed, state({ actual: 'the project edited this' }))).toBeUndefined()
  })

  it('rejects a forbidden path that exists', () => {
    expect(checkAsset(forbidden, state())?.reason).toContain('shadows')
  })

  it('accepts a forbidden path that is absent', () => {
    expect(checkAsset(forbidden, state({ isPresent: false }))).toBeUndefined()
  })
})

const agents: ManagedAsset = { path: 'AGENTS.md', disposition: 'SECTION', scope: 'REPOSITORY' }
const drifted = (): AssetState => state({ actual: 'edited' })

describe('findAssetViolations', () => {
  it('skips a path the project has taken over', () => {
    const assets: readonly ManagedAsset[] = [
      { path: 'CLAUDE.md', disposition: 'PINNED', scope: 'REPOSITORY' },
    ]
    expect(findAssetViolations(assets, [], drifted)).toHaveLength(1)
    expect(findAssetViolations(assets, ['CLAUDE.md'], drifted)).toEqual([])
  })
})

describe('syncAction', () => {
  it('always rewrites a pinned file so drift is repaired', () => {
    expect(syncAction({ path: 'a', disposition: 'PINNED', scope: 'REPOSITORY' }, true)).toBe(
      'write',
    )
    expect(syncAction({ path: 'a', disposition: 'PINNED', scope: 'REPOSITORY' }, false)).toBe(
      'write',
    )
  })

  it('writes a seed file only when it is absent', () => {
    expect(syncAction({ path: 'a', disposition: 'SEED', scope: 'REPOSITORY' }, true)).toBe('skip')
    expect(syncAction({ path: 'a', disposition: 'SEED', scope: 'REPOSITORY' }, false)).toBe('write')
  })

  it('deletes a forbidden path that exists', () => {
    expect(syncAction({ path: 'a', disposition: 'FORBIDDEN', scope: 'REPOSITORY' }, true)).toBe(
      'delete',
    )
    expect(syncAction({ path: 'a', disposition: 'FORBIDDEN', scope: 'REPOSITORY' }, false)).toBe(
      'skip',
    )
  })
})

// The SECTION disposition is the only one where ploaness and the project write the same file, so every
// test here is really asking the same question: does the harness keep its own block current without ever
// touching a line the project wrote?
describe('a managed section', () => {
  const block: string = `${SECTION_BEGIN}\ncontract v1\n${SECTION_END}`

  describe('readManagedSection', () => {
    it('reads the block back with its markers', () => {
      expect(readManagedSection(`${block}\n\nproject text`)).toStrictEqual({
        kind: 'present',
        block,
      })
    })

    it('finds no block in a file that has none', () => {
      expect(readManagedSection('project text only').kind).toBe('absent')
    })

    it('treats a file that does not exist yet as one with no block', () => {
      expect(readManagedSection('').kind).toBe('absent')
    })

    // Splicing on reversed markers would rewrite from the end marker back to the begin marker, which is
    // to say: the project's own text. Refusing is the only safe reading.
    it('refuses a file whose markers are in the wrong order', () => {
      expect(readManagedSection(`${SECTION_END}\nx\n${SECTION_BEGIN}\n`).kind).toBe('malformed')
    })

    // A second copy is worse than none: one of the two would go stale while the gate kept reporting the
    // other as current, so the file would carry a contradiction no check could see.
    it('refuses a file that carries the block twice', () => {
      expect(readManagedSection(`${block}\n\n${block}\n`).kind).toBe('malformed')
    })

    it('refuses a file that has one marker but not the other', () => {
      expect(readManagedSection(`${SECTION_BEGIN}\ncontract v1\n`).kind).toBe('malformed')
    })

    // The contract has to be the first thing an agent reads. A block buried below the project's own
    // prose is still findable, but it is no longer the thing that governs what precedes it.
    it('refuses a block the project pushed below its own prose', () => {
      expect(readManagedSection(`# Agent guide\n\n${block}\n`).kind).toBe('malformed')
    })
  })
})

// Splicing is the other half of the same question: the block is replaced without touching a line the
// project wrote.
describe('splicing a managed section', () => {
  const block: string = `${SECTION_BEGIN}\ncontract v1\n${SECTION_END}`

  describe('applyManagedSection', () => {
    it('replaces an outdated block and keeps the project text', () => {
      const current: string = `${SECTION_BEGIN}\ncontract v0\n${SECTION_END}\n\nproject text`
      expect(applyManagedSection(current, block)).toBe(`${block}\n\nproject text`)
    })

    it('puts the block above text that was never governed', () => {
      expect(applyManagedSection('project text', block)).toBe(`${block}\n\nproject text`)
    })

    it('writes only the block into a file that does not exist yet', () => {
      expect(applyManagedSection('', block)).toBe(`${block}\n`)
    })

    it('leaves a current file byte for byte alone, so sync reports no change', () => {
      const current: string = `${block}\n\nproject text`
      expect(applyManagedSection(current, block)).toBe(current)
    })

    // The refusal is what stops sync turning one ambiguous file into two blocks.
    it('refuses to edit a file whose markers are ambiguous', () => {
      expect(applyManagedSection(`${block}\n\n${block}\n`, block)).toBeUndefined()
    })
  })

  describe('checkAsset', () => {
    it('accepts a file whose leading block is current, whatever the project wrote below', () => {
      const actual: string = `${block}\n\nproject text`
      expect(checkAsset(agents, state({ actual, expected: block }))).toBeUndefined()
    })

    it('rejects a file whose block is stale', () => {
      const actual: string = `${SECTION_BEGIN}\ncontract v0\n${SECTION_END}`
      expect(checkAsset(agents, state({ actual, expected: block }))?.reason).toContain('drifted')
    })

    it('sends a file with no block to sync, which can repair it', () => {
      expect(checkAsset(agents, state({ actual: 'project text', expected: block }))?.reason).toBe(
        'the ploaness managed block is missing; run `ploaness sync`',
      )
    })

    // Sync refuses this file, so advising it here would send the project round a loop that never ends.
    it('sends a file with ambiguous markers to a human instead of to sync', () => {
      const actual: string = `${block}\n\n${block}\n`
      const reason: string = checkAsset(agents, state({ actual, expected: block }))?.reason ?? ''
      expect(reason).toContain('repair the markers by hand')
      expect(reason).not.toContain('ploaness sync')
    })
  })

  // Never `write`: that would replace the project's text with the block alone.
  it('is always spliced, whether or not the file already exists', () => {
    expect(syncAction(agents, true)).toBe('splice')
    expect(syncAction(agents, false)).toBe('splice')
  })
})

// The standard puts the rules in the root instruction file and lets a tool-specific one carry only a
// reference to it. ploaness pinned CLAUDE.md and constrained nothing else, so a project could hand
// Gemini or Cursor a second, contradicting set of instructions and no gate would say a word.
const holding = (actual: string | undefined): AssetState => ({
  isPresent: actual !== undefined,
  actual,
  expected: undefined,
})

describe('a tool-specific instruction file', () => {
  const reference: ManagedAsset = {
    path: 'GEMINI.md',
    disposition: 'REFERENCE',
    scope: 'REPOSITORY',
  }

  // A project that uses only one agent carries only its entry point. Requiring the file would make
  // ploaness decide which tools the project uses.
  it('accepts the file being absent', () => {
    expect(checkAsset(reference, holding(undefined))).toBeUndefined()
  })

  it('accepts a bare reference to the root instruction file', () => {
    expect(checkAsset(reference, holding('@AGENTS.md\n'))).toBeUndefined()
  })

  // The pointer's form is the tool's own: `@AGENTS.md` is Claude's import syntax and means nothing to
  // Cursor, so the rule reads for the name rather than demanding one spelling.
  it('accepts a reference written in the tool own words', () => {
    const prose: string = 'Follow the rules in AGENTS.md at the repository root.\n'
    expect(checkAsset(reference, holding(prose))).toBeUndefined()
  })

  it('rejects a file that states a rule of its own', () => {
    const found: AssetViolation | undefined = checkAsset(
      reference,
      holding('See AGENTS.md.\n\nAlways use tabs for indentation.\n'),
    )
    expect(found?.reason).toContain('instructions of its own')
  })

  it('rejects an empty file, which points at nothing', () => {
    expect(checkAsset(reference, holding(''))?.reason).toContain('is empty')
  })

  // ploaness writes neither state: creating one would hand the project an entry point for a tool it may
  // not use, and rewriting one would replace a pointer the tool understands with a guess.
  it('is never written by sync, present or absent', () => {
    expect(syncAction(reference, true)).toBe('skip')
    expect(syncAction(reference, false)).toBe('skip')
  })
})

const CATALOGUE: readonly ManagedAsset[] = [
  { path: '.editorconfig', disposition: 'PINNED', scope: 'REPOSITORY' },
  { path: 'tests/e2e/a11y.e2e.spec.ts', disposition: 'PINNED', scope: 'APPLICATION' },
  { path: 'tests/e2e/access-boundary.e2e.spec.ts', disposition: 'PINNED', scope: 'PAYLOAD' },
  { path: 'knip.json', disposition: 'FORBIDDEN', scope: 'EVERYWHERE' },
]

const pathsOf = (assets: readonly ManagedAsset[]): readonly string[] =>
  assets.map((asset: ManagedAsset): string => asset.path)

const scopesOf = (assets: readonly ManagedAsset[]): readonly AssetScope[] =>
  assets.map((asset: ManagedAsset): AssetScope => asset.scope)

const forRepository = (): readonly string[] => pathsOf(repositoryAssets(CATALOGUE))

const forMember = (overrides: Partial<AssetHost> = {}): readonly string[] =>
  pathsOf(memberAssets(CATALOGUE, host(overrides)))

const host = (overrides: Partial<AssetHost> = {}): AssetHost => ({
  hasRuntime: true,
  isPayload: true,
  ...overrides,
})

describe('where a managed path applies', () => {
  it('keeps the instruction files at the repository root', () => {
    expect(forRepository()).toEqual(['.editorconfig', 'knip.json'])
  })

  it('gives a Payload member every sweep', () => {
    expect(forMember()).toEqual([
      'tests/e2e/a11y.e2e.spec.ts',
      'tests/e2e/access-boundary.e2e.spec.ts',
      'knip.json',
    ])
  })

  it('withholds the access-boundary sweep from an application with no Payload', () => {
    // It asks Payload itself what it grants an anonymous caller. A Next application has no such
    // endpoint, so the sweep would fail on a project that did nothing wrong.
    expect(forMember({ isPayload: false })).toEqual(['tests/e2e/a11y.e2e.spec.ts', 'knip.json'])
  })

  it('gives a member with no application nothing but the forbidden paths', () => {
    expect(forMember({ hasRuntime: false, isPayload: false })).toEqual(['knip.json'])
  })

  it('forbids a shadowing config in both halves at once', () => {
    const atRoot: readonly AssetScope[] = scopesOf(repositoryAssets(CATALOGUE))
    const inMember: readonly AssetScope[] = scopesOf(memberAssets(CATALOGUE, host()))
    expect(atRoot).toContain('EVERYWHERE')
    expect(inMember).toContain('EVERYWHERE')
  })
})
