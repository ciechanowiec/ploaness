// knip ignores a path the project declares generated, as ESLint and the JavaScript ban do. The rendered
// configuration is what knip reads, so the test reads it too. Real files under this tree, for the reason
// editorconfig-generated.spec.ts states.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { knipConfig } from '../src/checks/toolchain.js'
import { createContext, type Member } from '../src/context.js'

const SPEC_DIRECTORY: string = path.dirname(fileURLToPath(import.meta.url))
const PREFIX: string = path.join(SPEC_DIRECTORY, 'tmp-knip-generated-')

interface RenderedConfig {
  readonly ignore?: readonly string[]
  readonly entry?: readonly string[]
}

const renderedFor = (ploaness: Readonly<Record<string, unknown>>): RenderedConfig => {
  const root: string = mkdtempSync(PREFIX)
  try {
    mkdirSync(path.join(root, 'src'))
    writeFileSync(path.join(root, 'src', 'index.ts'), 'export const value: number = 1\n')
    writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'subject', ploaness })}\n`)
    // A project of one package: the member at the root, with no siblings to stop at.
    const member: Member = { ...createContext(root, true), path: '.', isPayload: false, siblingPaths: [] }
    return JSON.parse(readFileSync(knipConfig(member), 'utf8')) as RenderedConfig
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('the knip configuration of a project with generated artefacts', () => {
  it('ignores the paths the project declares generated', () => {
    const rendered: RenderedConfig = renderedFor({
      generatedArtefacts: [{ pattern: 'export/site/assets/**', reason: 'written by the static export' }],
    })
    expect(rendered.ignore).toContain('export/site/assets/**')
  })

  it('keeps the shipped entries', () => {
    const rendered: RenderedConfig = renderedFor({
      generatedArtefacts: [{ pattern: 'export/site/assets/**', reason: 'written by the static export' }],
    })
    expect(rendered.entry).toContain('eslint.config.mjs')
  })

  it('does not ignore a path nothing declares generated', () => {
    expect(renderedFor({}).ignore ?? []).not.toContain('export/site/assets/**')
  })
})
