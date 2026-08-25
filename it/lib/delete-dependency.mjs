// Removes one declared devDependency from a package.json.
import { readFileSync, writeFileSync } from 'node:fs'

// node and this script's own path precede the caller's arguments.
const ARGUMENT_OFFSET = 2

// The indent every JSON file in this repository is written with.
const JSON_INDENT = 2

const [file, name] = process.argv.slice(ARGUMENT_OFFSET)
const parsed = JSON.parse(readFileSync(file, 'utf8'))
// Rebuilt without the name rather than deleted out of the parsed object: the omitted binding is what
// makes the removal readable, and nothing here mutates what it read.
const { [name]: _removed, ...devDependencies } = parsed.devDependencies
writeFileSync(file, `${JSON.stringify({ ...parsed, devDependencies }, null, JSON_INDENT)}\n`)
