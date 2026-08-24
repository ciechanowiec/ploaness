// Copies the consumer-facing Biome config, dropping its `root` flag.
//
// The shipped config declares `root: false`, because in a consumer it is extended rather than used
// directly. Biome ignores a non-root config's settings and silently formats with its own defaults, so
// the staged stand-in for the consumer's root config has that flag removed before the asset bodies are
// checked against it.
import { readFileSync, writeFileSync } from 'node:fs'

const [source, destination] = process.argv.slice(2)
const { root: _root, ...config } = JSON.parse(readFileSync(source, 'utf8'))
writeFileSync(destination, `${JSON.stringify(config, null, 2)}\n`)
