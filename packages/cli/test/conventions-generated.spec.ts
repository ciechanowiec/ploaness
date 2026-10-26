// The JavaScript ban spares a path the project declares generated, and that decision has to REACH the
// gate. A generator's output, such as the browser scripts of a static export, is not hand-written, and the
// allowlist cannot admit it, because its entries name a runtime to lint for that such a script runs in
// none of.
//
// Real files under this tree, for the reason editorconfig-generated.spec.ts states: the gate enumerates
// through `git ls-files`, a directory in the system temp folder belongs to no repository, and a test may
// not spawn git itself.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { conventions } from '../src/checks/conventions.js'
import { type Context, createContext, createRepository, type Repository } from '../src/context.js'
import type { GateResult } from '../src/exec.js'

const SPEC_DIRECTORY: string = path.dirname(fileURLToPath(import.meta.url))
const PREFIX: string = path.join(SPEC_DIRECTORY, 'tmp-conventions-generated-')
const GENERATED: string = 'export/site/assets/countdown.js'
const AUTHORED: string = 'src/tool.js'
const SCRIPT: string = 'document.title = String(Date.now())\n'
const BANNED: string = 'hand-written JavaScript is banned'

interface Declarations {
  readonly generatedArtefacts?: readonly { readonly pattern: string; readonly reason: string }[]
  readonly javascriptAllowlist?: readonly {
    readonly pattern: string
    readonly reason: string
    readonly runtime: string
  }[]
}

const GENERATED_EXPORT: Declarations = {
  generatedArtefacts: [{ pattern: 'export/site/assets/**', reason: 'written by the static export' }],
}

const write = (root: string, file: string, content: string): void => {
  const full: string = path.join(root, file)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content)
}

/** A project with the given declarations, holding a script at each of the given paths. */
const judge = (declarations: Declarations, scripts: readonly string[]): GateResult => {
  const root: string = mkdtempSync(PREFIX)
  try {
    write(root, 'package.json', `${JSON.stringify({ name: 'subject', ploaness: declarations })}\n`)
    for (const script of scripts) {
      write(root, script, SCRIPT)
    }
    const context: Context = createContext(root, true)
    return conventions(context)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('the JavaScript ban on a declared-generated path', () => {
  it('bans a script nothing declares', () => {
    expect(judge({}, [GENERATED]).findings).toEqual([`${GENERATED} ${BANNED}; write TypeScript instead`])
  })

  it('passes a script the project declares generated', () => {
    expect(judge(GENERATED_EXPORT, [GENERATED]).findings).toEqual([])
  })

  it('still bans a script outside the generated path', () => {
    expect(judge(GENERATED_EXPORT, [GENERATED, AUTHORED]).findings).toEqual([
      `${AUTHORED} ${BANNED}; write TypeScript instead`,
    ])
  })

  it('passes a script both declarations match', () => {
    const both: Declarations = {
      ...GENERATED_EXPORT,
      javascriptAllowlist: [{ pattern: '^export/site/assets/', reason: 'shipped as written', runtime: 'node' }],
    }
    expect(judge(both, [GENERATED]).findings).toEqual([])
  })
})

// A member declares its generated paths relative to itself, while this gate walks the tree once from the
// root, so the declaration has to be rebased onto the repository.
const MEMBER: string = 'web'

const judgeWorkspace = (scripts: readonly string[]): GateResult => {
  const root: string = mkdtempSync(PREFIX)
  try {
    write(root, 'pnpm-workspace.yaml', `packages:\n  - ${MEMBER}\n`)
    write(root, 'package.json', `${JSON.stringify({ name: 'subject-root' })}\n`)
    const manifest: Readonly<Record<string, unknown>> = {
      name: 'subject-member',
      devDependencies: { ploaness: '0.0.0' },
      ploaness: GENERATED_EXPORT,
    }
    write(root, path.join(MEMBER, 'package.json'), `${JSON.stringify(manifest)}\n`)
    for (const script of scripts) {
      write(root, script, SCRIPT)
    }
    const repository: Repository = createRepository(root, true)
    return conventions(repository)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('the JavaScript ban on a path a workspace member declares generated', () => {
  it('spares the member-relative declaration, rebased onto the repository', () => {
    expect(judgeWorkspace([path.join(MEMBER, GENERATED)]).findings).toEqual([])
  })

  it('still bans a script the member authored', () => {
    expect(judgeWorkspace([path.join(MEMBER, AUTHORED)]).findings).toEqual([
      `${MEMBER}/${AUTHORED} ${BANNED}; write TypeScript instead`,
    ])
  })
})
