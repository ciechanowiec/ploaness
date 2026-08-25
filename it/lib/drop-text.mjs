// Removes the first occurrence of a needle from a file.
//
// A needle that is already absent exits non-zero rather than writing the file back unchanged: a
// mutation that changes nothing produces a fixture that passes for the wrong reason, and a suite of
// those reports green while testing nothing.
import { readFileSync, writeFileSync } from 'node:fs'

// node and this script's own path precede the caller's arguments.
const ARGUMENT_OFFSET = 2

const [file, needle] = process.argv.slice(ARGUMENT_OFFSET)
const text = readFileSync(file, 'utf8')
if (!text.includes(needle)) {
  throw new Error(`the fixture no longer contains ${needle}; the mutation would be a no-op`)
}
writeFileSync(file, text.replace(needle, ''))
