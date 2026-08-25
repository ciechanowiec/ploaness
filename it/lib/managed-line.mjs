// Prints one non-blank line of the managed body ploaness ships.
//
// A fixture that restated the managed text in its own words would be a second copy of a value ploaness
// owns, and it would degrade into a silent no-op the moment ploaness reworded the block - which is
// exactly the defect this suite exists to catch.
import { readFileSync } from 'node:fs'

// node and this script's own path precede the caller's arguments.
const ARGUMENT_OFFSET = 2

const [file, index] = process.argv.slice(ARGUMENT_OFFSET)
const lines = readFileSync(file, 'utf8')
  .split('\n')
  .filter((line) => line.trim().length > 0)
const line = lines[Number(index)]
if (line === undefined) {
  throw new Error(`the managed body has no non-blank line ${index}`)
}
process.stdout.write(line)
