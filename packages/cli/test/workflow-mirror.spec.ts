import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { withWorkflowMirror } from '../src/workflow-mirror.js'

const withRoot = (use: (root: string) => void): void => {
  const root: string = mkdtempSync(path.join(tmpdir(), 'ploaness-workflow-test-'))
  try {
    use(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const write = (root: string, relative: string, content: string | Uint8Array): void => {
  const target: string = path.join(root, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
}

const workspaces = (): readonly string[] =>
  readdirSync(homedir()).filter((name: string): boolean => name.startsWith('.ploaness-actions-'))

describe('the actionlint filesystem view', () => {
  it('retains workflow and action paths, binary bytes, and a project marker', () => {
    withRoot((root: string): void => {
      const files: readonly string[] = ['.github/workflows/check.yml', 'automation/action/main.bin']
      const binary: Uint8Array = new Uint8Array([1, 0, 2])
      write(root, files[0] ?? '', 'name: workflow\n')
      write(root, files[1] ?? '', binary)
      withWorkflowMirror(root, files, (mirror: string): void => {
        expect(readFileSync(path.join(mirror, '.github/workflows/check.yml'), 'utf8')).toBe(
          'name: workflow\n',
        )
        expect(
          new Uint8Array(readFileSync(path.join(mirror, 'automation/action/main.bin'))),
        ).toEqual(binary)
        expect(existsSync(path.join(mirror, '.git'))).toBe(true)
      })
    })
  })

  it('excludes files absent from the inventory and preserves working-tree deletions', () => {
    withRoot((root: string): void => {
      write(root, '.env', 'LOCAL_ONLY=value\n')
      withWorkflowMirror(root, ['deleted.yml'], (mirror: string): void => {
        expect(existsSync(path.join(mirror, '.env'))).toBe(false)
        expect(existsSync(path.join(mirror, 'deleted.yml'))).toBe(false)
      })
    })
  })

  it('preserves a relative symlink without following it while copying', () => {
    withRoot((root: string): void => {
      write(root, 'entry.js', 'export const action = true\n')
      symlinkSync('entry.js', path.join(root, 'linked.js'))
      withWorkflowMirror(root, ['entry.js', 'linked.js'], (mirror: string): void => {
        expect(readlinkSync(path.join(mirror, 'linked.js'))).toBe('entry.js')
        expect(readFileSync(path.join(mirror, 'linked.js'), 'utf8')).toBe(
          'export const action = true\n',
        )
      })
    })
  })

  it('removes the temporary workspace after the analyzer returns', () => {
    withRoot((root: string): void => {
      const mirror: string = withWorkflowMirror(root, [], (directory: string): string => directory)
      expect(existsSync(path.dirname(mirror))).toBe(false)
    })
  })

  it('removes the temporary workspace when the analyzer throws', () => {
    withRoot((root: string): void => {
      const before: readonly string[] = workspaces()
      expect((): void => {
        withWorkflowMirror(root, [], (): void => {
          throw new Error('analyzer failed')
        })
      }).toThrow('analyzer failed')
      expect(workspaces()).toEqual(before)
    })
  })

  it.each(['../outside.yml', '/absolute.yml'])(
    'refuses a path outside the repository: %s',
    (candidate: string): void => {
      withRoot((root: string): void => {
        expect((): string =>
          withWorkflowMirror(root, [candidate], (mirror: string): string => mirror),
        ).toThrow('Workflow input is outside the repository')
      })
    },
  )
})
