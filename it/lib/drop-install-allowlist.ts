// Removes the `onlyBuiltDependencies` block from a pnpm workspace file: the key and the list items
// beneath it, leaving every other block intact.
import { readFileSync, writeFileSync } from 'node:fs'

// node and this script's own path precede the caller's arguments.
const ARGUMENT_OFFSET: number = 2

const [file]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (file === undefined) {
  throw new Error('usage: drop-install-allowlist.ts <pnpm-workspace.yaml>')
}

const ALLOWLIST_KEY: string = 'onlyBuiltDependencies:'

// The value `findIndex` returns when no line terminates the block.
const NOT_FOUND: number = -1

const readLines = (): readonly string[] => readFileSync(file, 'utf8').split('\n')

if (!readLines().includes(ALLOWLIST_KEY)) {
  // A mutation that changed nothing would leave the fixture identical to the pass case, and the gate it
  // is meant to fail would pass for a reason that has nothing to do with the rule under test.
  throw new Error(`${file} declares no ${ALLOWLIST_KEY} block, so this mutation would be a no-op`)
}

const LIST_ITEM: RegExp = /^\s+-\s/
const lines: readonly string[] = readLines()
const start: number = lines.indexOf(ALLOWLIST_KEY)

// Where the block ends: the first line after it that is not one of its list items. The filter used to
// have no terminator at all and dropped EVERY list item in the rest of the file - which was invisible
// only because the one block below this happens to be written as `key: value` rather than as a list.
const after: readonly string[] = lines.slice(start + 1)
const itemCount: number = after.findIndex((line: string): boolean => !LIST_ITEM.test(line))
const end: number = itemCount === NOT_FOUND ? lines.length : start + 1 + itemCount

writeFileSync(file, [...lines.slice(0, start), ...lines.slice(end)].join('\n'))
