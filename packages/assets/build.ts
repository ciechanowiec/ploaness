// Generates the shipped asset bodies from the files this repository already holds at its root.
//
// Seven paths exist twice: once at the root, where git, the editors, and the agents working on ploaness
// itself read them, and once as an `.asset` body, which is what a consumer receives. Nothing but
// discipline kept the two equal, and discipline lost - the guideline body was written at the first
// commit and never touched again while the root file was rewritten twice, so every consumer was pinned
// to a stale contract that no gate could see.
//
// The `.asset` suffix exists because npm strips a packed `.npmrc` and renames a packed `.gitignore`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type PairedAsset,
  type ParsedManifest,
  pairedAssets,
  parseManifest,
} from '@ploaness/governance'

const packageRoot: string = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot: string = path.join(packageRoot, '..', '..')

const manifest: ParsedManifest = parseManifest(
  readFileSync(path.join(packageRoot, 'manifest.tsv'), 'utf8'),
)
if (manifest.problems.length > 0) {
  throw new Error(`manifest.tsv is malformed:\n  ${manifest.problems.join('\n  ')}`)
}

// A missing root file is fatal rather than skipped: the pairing is derived from the manifest, so a path
// with no root twin means either the file was deleted or a new managed path needs declaring as authored
// directly as an asset. Skipping would ship the previous body forever.
const generated: readonly string[] = pairedAssets(manifest.assets).map(
  (pair: PairedAsset): string => {
    const source: string = path.join(workspaceRoot, pair.rootPath)
    const target: string = path.join(packageRoot, pair.assetPath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, readFileSync(source))
    return pair.assetPath
  },
)

console.info(`generated ${String(generated.length)} asset bodies:\n  ${generated.join('\n  ')}`)
