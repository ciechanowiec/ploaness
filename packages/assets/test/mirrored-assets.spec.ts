// Binds the generator in `build.mjs` to the tree it generates from. `findPairedAssetDrift` decides;
// this spec supplies the two sides by reading them, so a stale body is a named test failure rather
// than a defect a consumer discovers as a wrong contract.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  findPairedAssetDrift,
  type PairedAsset,
  type PairedAssetState,
  pairedAssets,
  parseManifest,
} from '@ploaness/governance'
import { describe, expect, it } from 'vitest'

const packageRoot: string = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot: string = path.join(packageRoot, '..', '..')

const readOrUndefined = (path: string): string | undefined =>
  existsSync(path) ? readFileSync(path, 'utf8') : undefined

const manifestText: string = readFileSync(path.join(packageRoot, 'manifest.tsv'), 'utf8')
const pairs: readonly PairedAsset[] = pairedAssets(parseManifest(manifestText).assets)

const states: readonly PairedAssetState[] = pairs.map(
  (pair: PairedAsset): PairedAssetState => ({
    pair,
    rootContent: readOrUndefined(path.join(workspaceRoot, pair.rootPath)),
    assetContent: readOrUndefined(path.join(packageRoot, pair.assetPath)),
  }),
)

describe('the shipped asset bodies', () => {
  it('parses the manifest without a malformed row', () => {
    expect(parseManifest(manifestText).problems).toEqual([])
  })

  it('derives a pair for every managed path ploaness generates from a root file', () => {
    expect(pairs.length).toBeGreaterThan(0)
  })

  it('matches the root files they are generated from', () => {
    expect(findPairedAssetDrift(states)).toEqual([])
  })

  it('carries the governing standard, which is the contract every consumer is held to', () => {
    const guideline: PairedAssetState | undefined = states.find(
      (state: PairedAssetState): boolean =>
        state.pair.rootPath === 'README-guideline-software-project.adoc',
    )
    expect(guideline?.assetContent).toBe(guideline?.rootContent)
  })
})
