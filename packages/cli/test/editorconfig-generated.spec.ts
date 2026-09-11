// The joint: the line cap is withheld from a path the project declares generated, and that decision has
// to REACH the gate. Testing the predicate alone would have stayed green through the defect these specs
// pin - the check computed the cap's reach from the file extension only, so a Payload migration, whose
// SQL statements each render as one 200-character string that no formatter run and no hand edit
// shortens, failed a gate the project could satisfy in no way but abandoning its declaration.
//
// Real files, for the reason sync-assets.spec.ts states: what is under test is what the gate reads off
// the working tree. The subject tree is created UNDER this one, because the gate enumerates through
// `git ls-files` and a directory in the system temp folder belongs to no repository - and a test may
// not spawn git itself. Untracked and unignored is enough to be enumerated, and the fixture is removed
// however the assertion ends.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { editorconfig } from '../src/checks/editorconfig.js'
import { type Context, createContext, createRepository, type Repository } from '../src/context.js'
import type { GateResult } from '../src/exec.js'

const SPEC_DIRECTORY: string = path.dirname(fileURLToPath(import.meta.url))
const PREFIX: string = path.join(SPEC_DIRECTORY, 'tmp-editorconfig-')
// The shipped body rather than a consumer's copy, as documented-gate-counts.spec.ts explains.
const EDITORCONFIG: string = path.join(SPEC_DIRECTORY, '../../assets/files/.editorconfig.asset')
const GENERATED: string = 'src/migrations/20260101_initial.ts'
const AUTHORED: string = 'src/lib/features.ts'
const OVER_THE_CAP: number = 200
const FIXTURE_FILES: number = 3

const write = (root: string, file: string, content: string): void => {
  const full: string = path.join(root, file)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content)
}

/** A project declaring `src/migrations/**` generated, holding whatever the caller writes into it. */
const withProject = (fill: (root: string) => void, use: (result: GateResult) => void): void => {
  const root: string = mkdtempSync(PREFIX)
  try {
    copyFileSync(EDITORCONFIG, path.join(root, '.editorconfig'))
    write(
      root,
      'package.json',
      `${JSON.stringify({
        name: 'subject',
        ploaness: {
          generatedArtefacts: [
            { pattern: 'src/migrations/**', reason: 'written by payload migrate:create' },
          ],
        },
      })}\n`,
    )
    fill(root)
    const context: Context = createContext(root, true)
    use(editorconfig(context))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const longLine: string = `const sql = '${'x'.repeat(OVER_THE_CAP)}'\n`

describe('the editorconfig gate on a declared-generated path', () => {
  it('passes a long line in a file the project declares generated', () => {
    withProject(
      (root: string): void => {
        write(root, GENERATED, longLine)
      },
      (result: GateResult): void => {
        expect(result.findings).toEqual([])
        // Named, so a tree the gate failed to enumerate cannot pass this as though it had been read.
        expect(result.summary).toContain(`${String(FIXTURE_FILES)} working-tree file(s)`)
      },
    )
  })

  it('still reports the same long line in a file the project authored', () => {
    withProject(
      (root: string): void => {
        write(root, AUTHORED, longLine)
      },
      (result: GateResult): void => {
        expect(result.ok).toBe(false)
        expect(result.findings.join('\n')).toContain(`${AUTHORED}:1 line is`)
      },
    )
  })

  it('holds a generated file to every rule but the cap, which its formatter does satisfy', () => {
    withProject(
      (root: string): void => {
        write(root, GENERATED, 'const value = 1   \n')
      },
      (result: GateResult): void => {
        expect(result.ok).toBe(false)
        expect(result.findings.join('\n')).toContain('trailing whitespace')
      },
    )
  })
})

// A member declares its generated paths relative to itself, while this gate walks the tree once from
// the root. The declaration has to be rebased onto the repository, or the member's migration is held
// to a cap the root never declared it free of - the reach a root-only context cannot exercise.
const MEMBER: string = 'cms'
const MEMBER_FILES: number = 5

const withWorkspace = (fill: (root: string) => void, use: (result: GateResult) => void): void => {
  const root: string = mkdtempSync(PREFIX)
  try {
    copyFileSync(EDITORCONFIG, path.join(root, '.editorconfig'))
    write(root, 'pnpm-workspace.yaml', `packages:\n  - ${MEMBER}\n`)
    write(root, 'package.json', `${JSON.stringify({ name: 'subject-root' })}\n`)
    write(
      root,
      path.join(MEMBER, 'package.json'),
      `${JSON.stringify({
        name: 'subject-member',
        devDependencies: { ploaness: '0.0.0' },
        ploaness: {
          generatedArtefacts: [
            { pattern: 'src/migrations/**', reason: 'written by payload migrate:create' },
          ],
        },
      })}\n`,
    )
    fill(root)
    const repository: Repository = createRepository(root, true)
    use(editorconfig(repository))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('the editorconfig gate on a path a workspace member declares generated', () => {
  it('withholds the cap from the member-relative declaration, rebased onto the repository', () => {
    withWorkspace(
      (root: string): void => {
        write(root, path.join(MEMBER, GENERATED), longLine)
      },
      (result: GateResult): void => {
        expect(result.findings).toEqual([])
        expect(result.summary).toContain(`${String(MEMBER_FILES)} working-tree file(s)`)
      },
    )
  })

  it('still reports the same long line in a file the member authored', () => {
    withWorkspace(
      (root: string): void => {
        write(root, path.join(MEMBER, AUTHORED), longLine)
      },
      (result: GateResult): void => {
        expect(result.ok).toBe(false)
        expect(result.findings.join('\n')).toContain(`${MEMBER}/${AUTHORED}:1 line is`)
      },
    )
  })
})
