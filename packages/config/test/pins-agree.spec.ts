// The joint between what ploaness pins for a consumer and what ploaness itself runs on.
//
// These are not assertions that a constant equals its own literal. Each reads two files that must agree
// and were free to drift: `pins.json` forced every governed project onto `pnpm@11.5.0` through a hard
// wiring failure while this repository ran `pnpm@11.9.0`, so the `fail-package-manager` fixture proved a
// version the harness did not use, and nothing anywhere would have said so.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { minimumNodeMajor } from '@ploaness/governance'
import { describe, expect, it } from 'vitest'

const specDirectory: string = path.dirname(fileURLToPath(import.meta.url))
const configPackage: string = path.join(specDirectory, '..')
const workspaceRoot: string = path.join(configPackage, '..', '..')

const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>

const pins: Record<string, unknown> = readJson(path.join(configPackage, 'pins.json'))
const rootManifest: Record<string, unknown> = readJson(path.join(workspaceRoot, 'package.json'))
const fixtureManifest: Record<string, unknown> = readJson(
  path.join(workspaceRoot, 'it', 'project', 'package.json'),
)

const enginesOf = (manifest: Record<string, unknown>): Record<string, string> =>
  (manifest['engines'] ?? {}) as Record<string, string>

describe('the package manager ploaness pins', () => {
  it('is the one this repository declares', () => {
    expect(pins['packageManager']).toBe(rootManifest['packageManager'])
  })

  it('is the one the consumer fixture declares, which the wiring gate then judges it against', () => {
    expect(fixtureManifest['packageManager']).toBe(pins['packageManager'])
  })
})

describe('the Node floor ploaness pins', () => {
  it('is the one this repository declares', () => {
    expect(enginesOf(pins)['node']).toBe(enginesOf(rootManifest)['node'])
  })

  // `preflight` used to carry its own `MINIMUM_NODE_MAJOR = 26`, and that copy was the one that decided
  // a verdict. It reads the pins now, so this asserts the pins say something a major can be read out of.
  it('names a major the preflight gate can read out of it', () => {
    expect(minimumNodeMajor(enginesOf(pins)['node'])).toBeGreaterThan(0)
  })

  it('is the major this repository runs on, as .nvmrc records it', () => {
    const nvmrc: string = readFileSync(path.join(workspaceRoot, '.nvmrc'), 'utf8').trim()
    expect(Number(nvmrc)).toBe(minimumNodeMajor(enginesOf(pins)['node']))
  })
})
