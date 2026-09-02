// The joint between what ploaness pins for a consumer and what ploaness itself runs on.
//
// These are not assertions that a constant equals its own literal. Each reads two files that must agree
// and were free to drift: `pins.json` forced every governed project onto `pnpm@11.5.0` through a hard
// wiring failure while this repository ran `pnpm@11.9.0`, so the `fail-package-manager` fixture proved a
// version the harness did not use, and nothing anywhere would have said so.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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

// `vite` is pinned for a reason the other ecosystem entries do not share: ploaness's own vitest resolves
// a vite of its own, and @vitejs/plugin-react declares vite as a PEER. A project declaring a different
// version installs a second one and the plugin loads against the wrong instance. The pin only closes
// that while it names the version ploaness itself resolves - and vitest's own range moves it without
// asking, so the two were free to drift the moment the pin was written.
const versionOfResolved = (specifier: string, from: string): string => {
  const resolveFrom: NodeJS.Require = createRequire(
    createRequire(from).resolve(`${specifier}/package.json`),
  )
  const manifest: Record<string, unknown> = readJson(resolveFrom.resolve('vite/package.json'))
  return manifest['version'] as string
}

const groupVersions = (name: string): Record<string, string> => {
  const groups: readonly unknown[] = pins['groups'] as readonly unknown[]
  const group: unknown = groups.find(
    (entry: unknown): boolean => (entry as Record<string, unknown>)['name'] === name,
  )
  return (group as Record<string, unknown>)['versions'] as Record<string, string>
}

describe('the vite version ploaness pins', () => {
  it('is the one this repository resolves through its own test runner', () => {
    expect(groupVersions('ecosystem')['vite']).toBe(
      versionOfResolved('vitest', path.join(configPackage, 'package.json')),
    )
  })

  it('is pinned to one exact version, so a consumer declares the same instance', () => {
    expect(groupVersions('ecosystem')['vite']).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

// The Next lint plugin is a dependency ploaness declares, so it is NOT in the pins - but its rules
// describe one Next release, and the Next monorepo publishes the two at the same version on every
// release. Two versions would have the linter judging a project against a Next the pin does not let it
// run. A bump to either therefore moves both, and this is the place that says so.
const configManifest: Record<string, unknown> = readJson(path.join(configPackage, 'package.json'))

const dependenciesOf = (manifest: Record<string, unknown>): Record<string, string> =>
  (manifest['dependencies'] ?? {}) as Record<string, string>

describe('the Next lint plugin ploaness declares', () => {
  it('is at the version of the next this file pins for every application', () => {
    expect(dependenciesOf(configManifest)['@next/eslint-plugin-next']).toBe(
      groupVersions('web')['next'],
    )
  })
})
