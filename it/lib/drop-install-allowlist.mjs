// Removes the `onlyBuiltDependencies` block from a pnpm workspace file: the key and the list items
// beneath it, leaving every other block intact.
import { readFileSync, writeFileSync } from 'node:fs'

// node and this script's own path precede the caller's arguments.
const ARGUMENT_OFFSET = 2

const ALLOWLIST_KEY = 'onlyBuiltDependencies:'

const [file] = process.argv.slice(ARGUMENT_OFFSET)
const lines = readFileSync(file, 'utf8').split('\n')
const start = lines.indexOf(ALLOWLIST_KEY)
const kept = lines.filter(
  (line, index) => start === -1 || index < start || !(index === start || /^\s+-\s/.test(line)),
)
writeFileSync(file, kept.join('\n'))
