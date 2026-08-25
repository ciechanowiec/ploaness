// The joint between what ploaness pins for a consumer and what ploaness itself runs on.
//
// These are not assertions that a constant equals its own literal. Each reads two files that must agree
// and were free to drift: `pins.json` forced every governed project onto `pnpm@11.5.0` through a hard
// wiring failure while this repository ran `pnpm@11.9.0`, so the `fail-package-manager` fixture proved a
// version the harness did not use, and nothing anywhere would have said so.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { minimumNodeMajor, pinnedPnpmVersion } from '@ploaness/governance'
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

  // `pinnedPnpmVersion` names whatever version text follows `pnpm@`, because its job is to read the
  // pin rather than to judge it. This is where the pin is judged: a range here would be derived
  // straight into every consumer's `engines.pnpm`, which is the one thing the derivation exists to
  // stop - the pin would then admit exactly the drift it was written to close.
  it('is pinned to one exact version, not to a range', () => {
    expect(pinnedPnpmVersion(pins['packageManager'] as string)).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

// The pnpm version is stated once, in `packageManager`, and `engines.pnpm` is derived from it by
// `version-policy.ts`. These assert the derivation is real rather than a second literal that happens to
// agree today: the pins must NOT carry an `engines.pnpm`, and both manifests must carry the derived
// value. The pair had already drifted apart in meaning before this - `pnpm@11.9.0` beside `>=11`.
describe('the pnpm version a consumer must declare', () => {
  it('is not restated in the pins, because it is derived from packageManager', () => {
    expect(enginesOf(pins)['pnpm']).toBeUndefined()
  })

  it.each([
    ['this repository', rootManifest],
    ['the consumer fixture', fixtureManifest],
  ])(
    'is what %s declares as its engines.pnpm',
    (_who: string, manifest: Record<string, unknown>) => {
      expect(enginesOf(manifest)['pnpm']).toBe(pinnedPnpmVersion(pins['packageManager'] as string))
    },
  )
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
