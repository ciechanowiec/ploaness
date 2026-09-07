import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { workingTreeFiles, workingTreeFingerprint } from '../src/working-tree.js'

const SPEC_DIRECTORY: string = path.dirname(fileURLToPath(import.meta.url))

const withTree = (use: (root: string) => void): void => {
  const root: string = mkdtempSync(path.join(SPEC_DIRECTORY, 'ploaness tree '))
  try {
    writeFileSync(path.join(root, '.gitignore'), 'dist/\n')
    writeFileSync(path.join(root, 'source.ts'), 'export const value = 1\n')
    use(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('working-tree evidence', () => {
  it('enumerates untracked source with spaces and excludes ignored build output', () => {
    withTree((root: string): void => {
      writeFileSync(path.join(root, 'new source.ts'), 'export const other = 2\n')
      mkdirSync(path.join(root, 'dist'))
      writeFileSync(path.join(root, 'dist/output.js'), 'generated\n')
      expect(workingTreeFiles(root)).toEqual(['.gitignore', 'new source.ts', 'source.ts'])
    })
  })

  it('detects newly created files and later edits to them', () => {
    withTree((root: string): void => {
      const before: string = workingTreeFingerprint(root)
      writeFileSync(path.join(root, 'new.ts'), 'first\n')
      const added: string = workingTreeFingerprint(root)
      writeFileSync(path.join(root, 'new.ts'), 'second\n')
      expect(added).not.toBe(before)
      expect(workingTreeFingerprint(root)).not.toBe(added)
    })
  })

  it('detects renamed and deleted source', () => {
    withTree((root: string): void => {
      const before: string = workingTreeFingerprint(root)
      renameSync(path.join(root, 'source.ts'), path.join(root, 'renamed.ts'))
      const renamed: string = workingTreeFingerprint(root)
      rmSync(path.join(root, 'renamed.ts'))
      expect(renamed).not.toBe(before)
      expect(workingTreeFingerprint(root)).not.toBe(renamed)
    })
  })

  it('fingerprints symlink targets without following them', () => {
    withTree((root: string): void => {
      symlinkSync('missing-one', path.join(root, 'link'))
      const before: string = workingTreeFingerprint(root)
      rmSync(path.join(root, 'link'))
      symlinkSync('missing-two', path.join(root, 'link'))
      expect(workingTreeFingerprint(root)).not.toBe(before)
    })
  })

  it('fails when Git cannot enumerate the directory', () => {
    expect(() => workingTreeFingerprint(path.join(tmpdir(), 'absent-ploaness-tree'))).toThrow()
  })
})
