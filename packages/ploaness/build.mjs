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

const here = path.dirname(fileURLToPath(import.meta.url))
const nodeRequire = createRequire(import.meta.url)

const shared = JSON.parse(readFileSync(nodeRequire.resolve('@ploaness/config/biome'), 'utf8'))
const generated = {
  ...shared,
  // A generated file: edit packages/config/biome.json instead.
  // biome-ignore lint/style/useNamingConvention: a JSON Schema keyword, dictated by the format
  $schema: shared.$schema,
}
writeFileSync(path.join(here, 'biome.json'), `${JSON.stringify(generated, null, 2)}\n`)
console.info(`ploaness: inlined biome.json (${Object.keys(generated).length} sections)`)

const sharedTsconfig = JSON.parse(
  readFileSync(nodeRequire.resolve('@ploaness/config/tsconfig'), 'utf8'),
)
// A generated file: edit packages/config/tsconfig.json instead. `extends` is stripped rather than
// followed, because the shared config is a leaf; if it ever gains a parent, that parent must be inlined
// here too rather than left as a hop a consumer cannot resolve.
if (typeof sharedTsconfig.extends === 'string') {
  throw new Error('the shared tsconfig gained an `extends`; inline its parent here before shipping')
}
writeFileSync(path.join(here, 'tsconfig.json'), `${JSON.stringify(sharedTsconfig, null, 2)}\n`)
console.info(
  `ploaness: inlined tsconfig.json (${Object.keys(sharedTsconfig.compilerOptions ?? {}).length} compiler options)`,
)
