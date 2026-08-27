// A config this package exports is data no compiler checks and no linter parses: ESLint validates the
// shape of each entry at load time, and rejects the WHOLE config when one entry carries a key it does
// not know. That is invisible from inside this repository, because nothing here loads the library
// config - `check-packaging.sh` proves the subpath RESOLVES, which is a different claim.
//
// It cost a real consumer its entire root lint pass. `vitestPlugin` was typed as a `FlatConfigBlock`
// and spread into `compose(...)` as an entry of its own; a plugin object carries `meta`, so ESLint
// answered `Unexpected key "meta" found` and linted nothing. The type system could not object, because
// `FlatConfigBlock` is `Readonly<Record<string, unknown>>` and a plugin satisfies it.
//
// So this asserts the joint rather than a literal: that what this package SHIPS is loadable by the
// ESLint it PINS. A plugin spread as an entry fails here whichever config it is spread into.
import { describe, expect, it } from 'vitest'
import payloadConfig from '../src/eslint.js'
import libraryConfig from '../src/eslint-library.js'

// ESLint 10's flat config object. `basePath` and `extends` are accepted by the config array's own
// normaliser rather than by a config object, but a shipped entry may legitimately carry either, so
// both are admitted here rather than treated as the defect this spec exists to catch.
const FLAT_CONFIG_KEYS: ReadonlySet<string> = new Set<string>([
  'basePath',
  'extends',
  'files',
  'ignores',
  'languageOptions',
  'linterOptions',
  'name',
  'plugins',
  'processor',
  'rules',
  'settings',
])

// The keys a PLUGIN carries and a config object does not. Naming them makes the failure message say
// what went wrong rather than only that a key was unrecognised.
const PLUGIN_KEYS: ReadonlySet<string> = new Set<string>(['configs', 'environments', 'meta'])

const SHIPPED: readonly (readonly [string, readonly unknown[]])[] = [
  ['ploaness/eslint', payloadConfig],
  ['ploaness/eslint-library', libraryConfig],
]

const foreignKeys = (entry: unknown): readonly string[] =>
  typeof entry === 'object' && entry !== null
    ? Object.keys(entry).filter((key: string): boolean => !FLAT_CONFIG_KEYS.has(key))
    : []

describe('every shipped ESLint config is loadable by the pinned ESLint', () => {
  it.each(SHIPPED)('%s carries only flat-config keys in every entry', (name, blocks) => {
    const offenders: readonly string[] = blocks.flatMap(
      (entry: unknown, index: number): readonly string[] =>
        foreignKeys(entry).map((key: string): string => `${name}[${String(index)}].${key}`),
    )
    expect(offenders).toEqual([])
  })

  it.each(SHIPPED)('%s spreads no plugin object as an entry of its own', (name, blocks) => {
    const spreadPlugins: readonly string[] = blocks
      .map((entry: unknown, index: number): readonly [number, readonly string[]] => [
        index,
        foreignKeys(entry).filter((key: string): boolean => PLUGIN_KEYS.has(key)),
      ])
      .filter(([, keys]: readonly [number, readonly string[]]): boolean => keys.length > 0)
      .map(
        ([index, keys]: readonly [number, readonly string[]]): string =>
          `${name}[${String(index)}] looks like a plugin, not a config block (${keys.join(', ')}); ` +
          'mount it under `plugins` in the block that states its rules',
      )
    expect(spreadPlugins).toEqual([])
  })
})
