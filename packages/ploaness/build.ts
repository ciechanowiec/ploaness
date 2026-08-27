// Generate the consumer-facing configs by inlining the shared ones.
//
// Chaining `extends` through two packages does not work for Biome: it resolves a nested extends against
// the project root rather than against the config that declares it, so the second hop silently fails and
// the project gets Biome's defaults instead of the ploaness rules. That failure is silent, which makes it
// worse than an error. Inlining removes the second hop entirely.
//
// The tsconfig has the same problem for a different reason. TypeScript itself resolves the chain fine,
// but a Payload project is also read by Next.js, whose tsconfig parser is not TypeScript's: it does not
// honour a package exports map, so `extends: "ploaness/tsconfig"` fails there even though `tsc` is happy.
// Inlining fixes both halves at once - the file is self-contained, and it is addressed by a real path
// (`ploaness/tsconfig.json`) that classic resolution can find without an exports map.

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { asRecord } from '@ploaness/governance'

const here: string = path.dirname(fileURLToPath(import.meta.url))
// The indent every JSON file in this repository is written with.
const JSON_INDENT: number = 2

const nodeRequire: NodeJS.Require = createRequire(import.meta.url)

const readJson = (specifier: string): Record<string, unknown> => {
  const resolved: string = nodeRequire.resolve(specifier)
  return asRecord(JSON.parse(readFileSync(resolved, 'utf8')))
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Child wins, but a section present in both is merged rather than replaced: the core carries
// `linter.rules` and the framework half carries `linter.domains`, and a shallow overwrite would drop
// every rule while reporting success.
const merge = (
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    const existing: unknown = merged[key]
    merged[key] = isPlainObject(existing) && isPlainObject(value) ? merge(existing, value) : value
  }
  return merged
}

// Follow a relative `extends` inside @ploaness/config and fold the parent in, so what ships is one
// self-contained file. The alternative is the silent failure this whole script exists to avoid: Biome
// resolves a nested extends against the project root rather than against the config declaring it, so a
// consumer would receive the framework half alone and be linted by Biome's defaults.
const flatten = (specifier: string): Record<string, unknown> => {
  const config: Record<string, unknown> = readJson(specifier)
  const parents: readonly string[] = [config['extends'] ?? []]
    .flat()
    .filter((entry: unknown): entry is string => typeof entry === 'string')
  if (parents.length === 0) {
    return config
  }
  const resolvedParents: Record<string, unknown> = parents.reduce(
    (accumulated: Record<string, unknown>, parent: string): Record<string, unknown> =>
      merge(accumulated, flatten(`@ploaness/config/${path.basename(parent, '.json')}`)),
    {},
  )
  const { extends: _dropped, ...own } = config
  return merge(resolvedParents, own)
}

const shared: Record<string, unknown> = flatten('@ploaness/config/biome')
const generated: Record<string, unknown> = {
  ...shared,
  // A generated file: edit packages/config/biome.json instead.
  // biome-ignore lint/style/useNamingConvention: a JSON Schema keyword, dictated by the format
  $schema: shared['$schema'],
}
writeFileSync(path.join(here, 'biome.json'), `${JSON.stringify(generated, null, JSON_INDENT)}\n`)
console.info(`ploaness: inlined biome.json (${String(Object.keys(generated).length)} sections)`)

// A generated file: edit packages/config/tsconfig.json instead. A parent is folded in rather than left
// as a hop, because Next.js reads this file with its own tsconfig parser, which honours neither a
// package exports map nor a chain it cannot resolve.
const sharedTsconfig: Record<string, unknown> = flatten('@ploaness/config/tsconfig')
if (typeof sharedTsconfig['extends'] === 'string') {
  throw new TypeError(
    'the shipped tsconfig still carries an `extends`; flattening did not resolve it',
  )
}
writeFileSync(
  path.join(here, 'tsconfig.json'),
  `${JSON.stringify(sharedTsconfig, null, JSON_INDENT)}\n`,
)
const compilerOptions: Record<string, unknown> = asRecord(sharedTsconfig['compilerOptions'])
console.info(
  `ploaness: inlined tsconfig.json (${String(Object.keys(compilerOptions).length)} compiler options)`,
)

// The library halves ship as they are: each is already self-contained, and a member with no framework
// extends it directly.
for (const core of ['biome-core', 'tsconfig-core']) {
  const body: Record<string, unknown> = flatten(`@ploaness/config/${core}`)
  writeFileSync(path.join(here, `${core}.json`), `${JSON.stringify(body, null, JSON_INDENT)}\n`)
  console.info(`ploaness: inlined ${core}.json`)
}
