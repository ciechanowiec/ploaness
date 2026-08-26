// Copies the consumer-facing Biome config, dropping its `root` flag.
//
// The shipped config declares `root: false`, because in a consumer it is extended rather than used
// directly. Biome ignores a non-root config's settings and silently formats with its own defaults, so
// the staged stand-in for the consumer's root config has that flag removed before the asset bodies are
// checked against it.
import { readFileSync, writeFileSync } from 'node:fs'
import { asRecord } from '@ploaness/governance'

// node and this script's own path precede the caller's arguments.
const ARGUMENT_OFFSET: number = 2

const [source, destination]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (source === undefined || destination === undefined) {
  throw new Error('usage: strip-root-flag.ts <source> <destination>')
}

// The indent every JSON file in this repository is written with.
const JSON_INDENT: number = 2

const { root: _root, ...config }: Record<string, unknown> = asRecord(
  JSON.parse(readFileSync(source, 'utf8')),
)
writeFileSync(destination, `${JSON.stringify(config, null, JSON_INDENT)}\n`)
