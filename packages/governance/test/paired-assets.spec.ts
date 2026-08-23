import { describe, expect, it } from 'vitest'
import type { ManagedAsset } from '../src/asset-policy.js'
import {
  findPairedAssetDrift,
  type PairedAsset,
  type PairedAssetDrift,
  type PairedAssetState,
  pairedAssets,
} from '../src/paired-assets.js'

const catalogue: readonly ManagedAsset[] = [
  { path: 'README-guideline-software-project.adoc', disposition: 'PINNED' },
  { path: '.ploaness/agent-guide.md', disposition: 'PINNED' },
  { path: 'AGENTS.md', disposition: 'SECTION' },
  { path: '.gitignore', disposition: 'SEED' },
  { path: '.gitleaks.toml', disposition: 'FORBIDDEN' },
]

const pathsOf = (pairs: readonly PairedAsset[]): readonly string[] =>
  pairs.map((pair: PairedAsset): string => pair.rootPath)

const state = (overrides: Partial<PairedAssetState> = {}): PairedAssetState => ({
  pair: { rootPath: '.nvmrc', assetPath: 'files/.nvmrc.asset' },
  rootContent: '26\n',
  assetContent: '26\n',
  ...overrides,
})

describe('pairedAssets', () => {
  it('pairs a PINNED entry with the body generated from it', () => {
    expect(pathsOf(pairedAssets(catalogue))).toContain('README-guideline-software-project.adoc')
  })

  it('pairs a SEED entry, whose body ploaness also generates', () => {
    expect(pathsOf(pairedAssets(catalogue))).toContain('.gitignore')
  })

  it('leaves a FORBIDDEN entry unpaired, because ploaness ships no body for it', () => {
    expect(pathsOf(pairedAssets(catalogue))).not.toContain('.gitleaks.toml')
  })

  it('leaves a SECTION entry unpaired, because its body is a block and not a whole file', () => {
    expect(pathsOf(pairedAssets(catalogue))).not.toContain('AGENTS.md')
  })

  it('leaves a path ploaness authors directly as an asset unpaired', () => {
    expect(pathsOf(pairedAssets(catalogue))).not.toContain('.ploaness/agent-guide.md')
  })

  it('pairs a newly managed path by default, so forgetting to mirror one cannot pass', () => {
    const added: readonly ManagedAsset[] = [
      ...catalogue,
      { path: '.tool-versions', disposition: 'PINNED' },
    ]
    expect(pathsOf(pairedAssets(added))).toContain('.tool-versions')
  })

  it('places the generated body under the assets directory with the packed suffix', () => {
    const pair: PairedAsset | undefined = pairedAssets([
      { path: '.npmrc', disposition: 'PINNED' },
    ])[0]
    expect(pair?.assetPath).toBe('files/.npmrc.asset')
  })
})

describe('findPairedAssetDrift', () => {
  it('accepts a body that still matches its root file', () => {
    expect(findPairedAssetDrift([state()])).toEqual([])
  })

  it('reports a body that has fallen behind its root file', () => {
    const found: readonly PairedAssetDrift[] = findPairedAssetDrift([
      state({ assetContent: '24\n' }),
    ])
    expect(found).toHaveLength(1)
    expect(found[0]?.reason).toContain('no longer matches')
  })

  it('names the root file, so the report says which source to regenerate from', () => {
    const found: readonly PairedAssetDrift[] = findPairedAssetDrift([
      state({ assetContent: '24\n' }),
    ])
    expect(found[0]?.rootPath).toBe('.nvmrc')
  })

  it('reports a body that was never generated', () => {
    const found: readonly PairedAssetDrift[] = findPairedAssetDrift([
      state({ assetContent: undefined }),
    ])
    expect(found[0]?.reason).toContain('is missing')
  })

  it('reports a pair whose root file is gone, rather than silently shipping the stale body', () => {
    const found: readonly PairedAssetDrift[] = findPairedAssetDrift([
      state({ rootContent: undefined }),
    ])
    expect(found[0]?.reason).toContain('no root file')
  })

  it('judges every pair, so one clean body cannot hide a drifted one', () => {
    const drifted: PairedAssetState = state({
      pair: { rootPath: '.npmrc', assetPath: 'files/.npmrc.asset' },
      assetContent: 'other',
    })
    expect(findPairedAssetDrift([state(), drifted])).toHaveLength(1)
  })
})
