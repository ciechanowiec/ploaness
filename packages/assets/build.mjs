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
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pairedAssets, parseManifest } from '@ploaness/governance'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = join(packageRoot, '..', '..')

const manifest = parseManifest(readFileSync(join(packageRoot, 'manifest.tsv'), 'utf8'))
if (manifest.problems.length > 0) {
  console.error(`manifest.tsv is malformed:\n  ${manifest.problems.join('\n  ')}`)
  process.exit(1)
}

// A missing root file is fatal rather than skipped: the pairing is derived from the manifest, so a path
// with no root twin means either the file was deleted or a new managed path needs declaring as authored
// directly as an asset. Skipping would ship the previous body forever.
const generated = pairedAssets(manifest.assets).map((pair) => {
  const source = join(workspaceRoot, pair.rootPath)
  const target = join(packageRoot, pair.assetPath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, readFileSync(source))
  return pair.assetPath
})

console.info(`generated ${generated.length} asset bodies:\n  ${generated.join('\n  ')}`)
