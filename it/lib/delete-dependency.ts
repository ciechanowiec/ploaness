// Removes one declared devDependency from a package.json.
import { readFileSync, writeFileSync } from 'node:fs'
import { asRecord } from '@ploaness/governance'

// node and this script's own path precede the caller's arguments.
const ARGUMENT_OFFSET: number = 2

const [file, name]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (file === undefined || name === undefined) {
  throw new Error('usage: delete-dependency.ts <package.json> <dependency-name>')
}

const parsed: Record<string, unknown> = asRecord(JSON.parse(readFileSync(file, 'utf8')))
const declaredDevelopmentDependencies: Record<string, unknown> = asRecord(parsed['devDependencies'])

if (!Object.hasOwn(declaredDevelopmentDependencies, name)) {
  // Silently removing nothing left the fixture identical to the pass case, so the gate it is meant to
  // fail would have passed for a reason unrelated to the rule under test - and the suite would have
  // reported that as proof. Its sibling `drop-text.ts` refuses the same way, for the same reason.
  throw new Error(`${file} declares no devDependency "${name}", so this mutation would be a no-op`)
}

// The indent every JSON file in this repository is written with.
const JSON_INDENT: number = 2

// Rebuilt without the name rather than deleted out of the parsed object: the omitted binding is what
// makes the removal readable, and nothing here mutates what it read.
const { [name]: _removed, ...devDependencies } = declaredDevelopmentDependencies
writeFileSync(file, `${JSON.stringify({ ...parsed, devDependencies }, null, JSON_INDENT)}\n`)
