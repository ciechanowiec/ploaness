import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type ManagedAsset, parseManifest } from '@ploaness/governance'
import { describe, expect, it } from 'vitest'

interface ManagedDefault {
  readonly path: string
  readonly expected: string
}

const packageRoot: string = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot: string = path.join(packageRoot, '..', '..')
const fixtures: readonly ManagedDefault[] = JSON.parse(
  readFileSync(path.join(workspaceRoot, 'it/fixtures/managed-defaults.json'), 'utf8'),
) as readonly ManagedDefault[]
const catalogue: readonly ManagedAsset[] = parseManifest(
  readFileSync(path.join(packageRoot, 'manifest.tsv'), 'utf8'),
).assets

describe('the upstream editor and Git defaults', () => {
  it.each(fixtures)('keeps $path pinned at repository scope', (fixture: ManagedDefault) => {
    expect(catalogue.find((entry: ManagedAsset): boolean => entry.path === fixture.path)).toEqual({
      path: fixture.path,
      disposition: 'PINNED',
      scope: 'REPOSITORY',
    })
  })

  it.each(fixtures)('ships the exact canonical bytes for $path', (fixture: ManagedDefault) => {
    const expected: Buffer = Buffer.from(fixture.expected, 'utf8')
    expect(readFileSync(path.join(workspaceRoot, fixture.path))).toEqual(expected)
    expect(readFileSync(path.join(packageRoot, 'files', `${fixture.path}.asset`))).toEqual(expected)
  })
})
