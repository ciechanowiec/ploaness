// knip leaves the modules a declared runtime provides out of its unlisted dependencies. A CloudFront
// Function reads its key value store through `require('cloudfront')`, a module of the runtime that no
// package supplies. The rendered configuration is what knip reads, so the test reads it too. Real files
// under this tree, for the reason editorconfig-generated.spec.ts states.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { knipConfig } from '../src/checks/toolchain.js'
import { createContext, type Member } from '../src/context.js'

const SPEC_DIRECTORY: string = path.dirname(fileURLToPath(import.meta.url))
const PREFIX: string = path.join(SPEC_DIRECTORY, 'tmp-knip-runtime-')
const FUNCTION: string = 'edge/viewer-request.cjs'
const SOURCE: string = "const store = require('cloudfront').kvs()\nmodule.exports = { store }\n"

interface RenderedConfig {
  readonly ignoreDependencies?: readonly string[]
}

const renderedFor = (runtime: string, files: readonly string[]): RenderedConfig => {
  const root: string = mkdtempSync(PREFIX)
  try {
    const ploaness: Readonly<Record<string, unknown>> = {
      javascriptAllowlist: [{ pattern: String.raw`^edge/viewer-request\.cjs$`, reason: 'an edge function', runtime }],
    }
    writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'subject', ploaness })}\n`)
    for (const file of files) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      writeFileSync(path.join(root, file), SOURCE)
    }
    // A project of one package: the member at the root, with no siblings to stop at.
    const member: Member = { ...createContext(root, true), path: '.', isPayload: false, siblingPaths: [] }
    return JSON.parse(readFileSync(knipConfig(member), 'utf8')) as RenderedConfig
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('the knip configuration of a project with a CloudFront function', () => {
  it('lets the function import the runtime module no package supplies', () => {
    expect(renderedFor('cloudfront-js-2.0', [FUNCTION]).ignoreDependencies).toContain('cloudfront')
  })

  it('keeps the shipped dependency exemptions', () => {
    expect(renderedFor('cloudfront-js-2.0', [FUNCTION]).ignoreDependencies).toContain('@payloadcms/ui')
  })

  it('still reports the module for a file declared for node', () => {
    expect(renderedFor('node', [FUNCTION]).ignoreDependencies ?? []).not.toContain('cloudfront')
  })

  it('still reports the module when the declared function is not in the tree', () => {
    expect(renderedFor('cloudfront-js-2.0', []).ignoreDependencies ?? []).not.toContain('cloudfront')
  })
})
