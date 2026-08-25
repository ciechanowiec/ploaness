// Copies the consumer-facing Biome config, dropping its `root` flag.
//
// The shipped config declares `root: false`, because in a consumer it is extended rather than used
// directly. Biome ignores a non-root config's settings and silently formats with its own defaults, so
// the staged stand-in for the consumer's root config has that flag removed before the asset bodies are
// checked against it.
import { readFileSync, writeFileSync } from 'node:fs'

// node and this script's own path precede the caller's arguments.
const ARGUMENT_OFFSET = 2

// The indent every JSON file in this repository is written with.
const JSON_INDENT = 2

const [source, destination] = process.argv.slice(ARGUMENT_OFFSET)
const { root: _root, ...config } = JSON.parse(readFileSync(source, 'utf8'))
writeFileSync(destination, `${JSON.stringify(config, null, JSON_INDENT)}\n`)
