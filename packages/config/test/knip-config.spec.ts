// The joint between what the meta package re-exports and what the shipped knip config forgives.
//
// A consumer declares `ploaness` and nothing else, which is what the wiring gate requires of it. knip
// resolves `import ploaness from 'ploaness/vitest'` through that re-export to `@ploaness/config` and
// reports the consumer for not declaring a package it is not supposed to declare. Every gate above knip
// had to pass before anything said so, which is why a correctly wired project carried this for as long
// as it did.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const specDirectory: string = path.dirname(fileURLToPath(import.meta.url))
const configPackage: string = path.join(specDirectory, '..')
// The shim SOURCES. They are TypeScript now and compile into `dist`, so a listing of the package root
// would find only generated JSON and report that no entry point re-exports anything.
const metaPackage: string = path.join(configPackage, '..', 'ploaness', 'src')

interface KnipConfig {
  readonly ignoreDependencies?: readonly string[]
}

const knip: KnipConfig = JSON.parse(
  readFileSync(path.join(configPackage, 'knip.json'), 'utf8'),
) as KnipConfig

const INTERNAL_SPECIFIER: RegExp = /from '(@ploaness\/[a-z-]+)/g

// Read out of the entry shims rather than listed here, so a new one is covered by the rule that already
// exists instead of by an entry somebody has to remember to add.
const reExportedPackages = (): readonly string[] => {
  const shims: readonly string[] = readdirSync(metaPackage).filter((file: string): boolean =>
    file.endsWith('.ts'),
  )
  const found: readonly string[] = shims.flatMap((file: string): readonly string[] =>
    [...readFileSync(path.join(metaPackage, file), 'utf8').matchAll(INTERNAL_SPECIFIER)].map(
      (match: RegExpMatchArray): string => match[1] ?? '',
    ),
  )
  return [...new Set(found)]
}

const isForgiven = (name: string): boolean =>
  (knip.ignoreDependencies ?? []).some((pattern: string): boolean =>
    new RegExp(`^${pattern}$`).test(name),
  )

describe('the knip config a consumer receives', () => {
  it('finds the entry shims it is meant to cover', () => {
    expect(reExportedPackages().length).toBeGreaterThan(0)
  })

  it.each(reExportedPackages())(
    'forgives %s, which a consumer reaches only through the meta package',
    (name: string) => {
      expect(isForgiven(name)).toBe(true)
    },
  )
})
