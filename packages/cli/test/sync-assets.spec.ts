// `ploaness sync` reports the changes it made, and an agent acts on that report. These tests use real
// files for the reason secret-mirror.spec.ts states: the byte comparison is the behaviour under test.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasCopiedChange } from '../src/checks/assets.js'

const PREFIX: string = path.join(tmpdir(), 'ploaness-sync-assets-')

interface Workspace {
  readonly directory: string
  readonly source: string
  readonly target: string
}

const withWorkspace = (use: (workspace: Workspace) => void): void => {
  const directory: string = mkdtempSync(PREFIX)
  try {
    use({
      directory,
      source: path.join(directory, 'catalogue', 'body.txt'),
      target: path.join(directory, 'tree', 'nested', 'body.txt'),
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const write = (file: string, content: string): void => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content)
}

describe('hasCopiedChange', () => {
  it('writes an absent target, creating its directories', () => {
    withWorkspace(({ source, target }: Workspace): void => {
      write(source, 'managed\n')
      expect(hasCopiedChange(source, target)).toBe(true)
      expect(readFileSync(target, 'utf8')).toBe('managed\n')
    })
  })

  it('rewrites a target whose bytes differ', () => {
    withWorkspace(({ source, target }: Workspace): void => {
      write(source, 'managed\n')
      hasCopiedChange(source, target)
      writeFileSync(target, 'drifted\n')
      expect(hasCopiedChange(source, target)).toBe(true)
      expect(readFileSync(target, 'utf8')).toBe('managed\n')
    })
  })

  it('reports no change and leaves the file untouched when the bytes already match', () => {
    withWorkspace(({ source, target }: Workspace): void => {
      write(source, 'managed\n')
      hasCopiedChange(source, target)
      const before: number = statSync(target).mtimeMs
      expect(hasCopiedChange(source, target)).toBe(false)
      expect(statSync(target).mtimeMs).toBe(before)
    })
  })
})
