// Prints one non-blank line of the managed body ploaness ships.
//
// A fixture that restated the managed text in its own words would be a second copy of a value ploaness
// owns, and it would degrade into a silent no-op the moment ploaness reworded the block - which is
// exactly the defect this suite exists to catch.
import { readFileSync } from 'node:fs'

const [file, index] = process.argv.slice(2)
const lines = readFileSync(file, 'utf8')
  .split('\n')
  .filter((line) => line.trim().length > 0)
const line = lines[Number(index)]
if (line === undefined) {
  console.error(`the managed body has no non-blank line ${index}`)
  process.exit(1)
}
process.stdout.write(line)
