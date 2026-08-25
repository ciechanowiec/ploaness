// Removes one declared devDependency from a package.json.
import { readFileSync, writeFileSync } from 'node:fs'

// node and this script's own path precede the caller's arguments.
const ARGUMENT_OFFSET = 2

const [file, name] = process.argv.slice(ARGUMENT_OFFSET)

const declaredDevelopmentDependencies = () =>
  JSON.parse(readFileSync(file, 'utf8')).devDependencies ?? {}

if (!Object.hasOwn(declaredDevelopmentDependencies(), name)) {
  // Silently removing nothing left the fixture identical to the pass case, so the gate it is meant to
  // fail would have passed for a reason unrelated to the rule under test - and the suite would have
  // reported that as proof. Its sibling `drop-text.mjs` refuses the same way, for the same reason.
  throw new Error(`${file} declares no devDependency "${name}", so this mutation would be a no-op`)
}
const parsed = JSON.parse(readFileSync(file, 'utf8'))
// Rebuilt without the name rather than deleted out of the parsed object: the omitted binding is what
// makes the removal readable, and nothing here mutates what it read.
// The indent every JSON file in this repository is written with.
const JSON_INDENT = 2

const { [name]: _removed, ...devDependencies } = declaredDevelopmentDependencies()
writeFileSync(file, `${JSON.stringify({ ...parsed, devDependencies }, null, JSON_INDENT)}\n`)
