// Removes the `onlyBuiltDependencies` block from a pnpm workspace file: the key and the list items
// beneath it, leaving every other block intact.
import { readFileSync, writeFileSync } from 'node:fs'

const ALLOWLIST_KEY = 'onlyBuiltDependencies:'

const [file] = process.argv.slice(2)
const lines = readFileSync(file, 'utf8').split('\n')
const start = lines.indexOf(ALLOWLIST_KEY)
const kept = lines.filter(
  (line, index) => start === -1 || index < start || !(index === start || /^\s+-\s/.test(line)),
)
writeFileSync(file, kept.join('\n'))
