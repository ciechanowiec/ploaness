// Directory-mode secret scanning is safe only because this mirror contains exactly the paths Git gave
// the gate. These tests use real files: a fake filesystem would prove the fake rather than the path,
// symlink, and byte behavior on which the container mount depends.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mirrorSecretCandidates } from '../src/secret-mirror.js'

const PREFIX: string = path.join(tmpdir(), 'ploaness-secret-mirror-')

interface Workspace {
  readonly directory: string
  readonly root: string
  readonly mirror: string
}

const newWorkspace = (): Workspace => {
  const directory: string = mkdtempSync(PREFIX)
  const root: string = path.join(directory, 'root')
  const mirror: string = path.join(directory, 'mirror')
  mkdirSync(root)
  mkdirSync(mirror)
  return { directory, root, mirror }
}

const withWorkspace = (use: (workspace: Workspace) => void): void => {
  const workspace: Workspace = newWorkspace()
  try {
    use(workspace)
  } finally {
    rmSync(workspace.directory, { recursive: true, force: true })
  }
}

const write = (root: string, relative: string, content: string | Uint8Array): void => {
  const target: string = path.join(root, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
}

describe('mirrorSecretCandidates', () => {
  it('preserves a nested text file path and bytes', () => {
    withWorkspace(({ root, mirror }: Workspace): void => {
      write(root, 'src/nested/config.ts', 'export const value = 1\n')
      expect(mirrorSecretCandidates(root, mirror, ['src/nested/config.ts'])).toEqual([
        'src/nested/config.ts',
      ])
      expect(readFileSync(path.join(mirror, 'src/nested/config.ts'), 'utf8')).toBe(
        'export const value = 1\n',
      )
    })
  })

  it('copies only candidates supplied by the Git-aware caller', () => {
    withWorkspace(({ root, mirror }: Workspace): void => {
      write(root, 'visible.txt', 'visible')
      write(root, 'ignored.env', 'ignored')
      expect(mirrorSecretCandidates(root, mirror, ['visible.txt'])).toEqual(['visible.txt'])
      expect(() => readFileSync(path.join(mirror, 'ignored.env'))).toThrow()
    })
  })

  it('skips a binary file carrying a NUL byte', () => {
    withWorkspace(({ root, mirror }: Workspace): void => {
      write(root, 'image.bin', new Uint8Array([1, 0, 2]))
      expect(mirrorSecretCandidates(root, mirror, ['image.bin'])).toEqual([])
    })
  })

  it('skips a missing or deleted candidate', () => {
    withWorkspace(({ root, mirror }: Workspace): void => {
      expect(mirrorSecretCandidates(root, mirror, ['deleted.ts'])).toEqual([])
    })
  })

  it('skips directories', () => {
    withWorkspace(({ root, mirror }: Workspace): void => {
      mkdirSync(path.join(root, 'src'))
      expect(mirrorSecretCandidates(root, mirror, ['src'])).toEqual([])
    })
  })

  it('does not follow a symlink outside the repository', () => {
    withWorkspace(({ directory, root, mirror }: Workspace): void => {
      const outside: string = path.join(directory, 'outside.txt')
      writeFileSync(outside, 'outside')
      symlinkSync(outside, path.join(root, 'linked.txt'))
      expect(mirrorSecretCandidates(root, mirror, ['linked.txt'])).toEqual([])
    })
  })

  it.each(['../outside.txt', '/absolute.txt'])(
    'refuses a candidate outside the repository: %s',
    (candidate: string) => {
      withWorkspace(({ root, mirror }: Workspace): void => {
        expect(mirrorSecretCandidates(root, mirror, [candidate])).toEqual([])
      })
    },
  )
})
