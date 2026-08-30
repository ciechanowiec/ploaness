// Removes one declared dependency from a package.json, from whichever block declares it.
import { readFileSync, writeFileSync } from 'node:fs'
import { asRecord } from '@ploaness/governance'

// node and this script's own path precede the caller's arguments.
const ARGUMENT_OFFSET: number = 2

const [file, name]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (file === undefined || name === undefined) {
  throw new Error('usage: delete-dependency.ts <package.json> <dependency-name>')
}

const parsed: Record<string, unknown> = asRecord(JSON.parse(readFileSync(file, 'utf8')))

// Both blocks, because which one holds a package is the project's decision rather than this script's.
// It read `devDependencies` alone while every package a fixture removed happened to live there, and the
// first one that did not - `@ploaness/runtime`, which an application declares in `dependencies` because
// `src/**` imports it - failed here rather than in the gate it was written to exercise.
const BLOCKS: readonly string[] = ['dependencies', 'devDependencies']

const holder: string | undefined = BLOCKS.find((block: string): boolean =>
  Object.hasOwn(asRecord(parsed[block]), name),
)

if (holder === undefined) {
  // Silently removing nothing left the fixture identical to the pass case, so the gate it is meant to
  // fail would have passed for a reason unrelated to the rule under test - and the suite would have
  // reported that as proof. Its sibling `drop-text.ts` refuses the same way, for the same reason.
  throw new Error(`${file} declares no dependency "${name}", so this mutation would be a no-op`)
}

// The indent every JSON file in this repository is written with.
const JSON_INDENT: number = 2

// Rebuilt without the name rather than deleted out of the parsed object: the omitted binding is what
// makes the removal readable, and nothing here mutates what it read.
const { [name]: _removed, ...remaining } = asRecord(parsed[holder])
writeFileSync(file, `${JSON.stringify({ ...parsed, [holder]: remaining }, null, JSON_INDENT)}\n`)
