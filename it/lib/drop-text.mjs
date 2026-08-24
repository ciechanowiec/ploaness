// Removes the first occurrence of a needle from a file.
//
// A needle that is already absent exits non-zero rather than writing the file back unchanged: a
// mutation that changes nothing produces a fixture that passes for the wrong reason, and a suite of
// those reports green while testing nothing.
import { readFileSync, writeFileSync } from 'node:fs'

const [file, needle] = process.argv.slice(2)
const text = readFileSync(file, 'utf8')
if (!text.includes(needle)) {
  console.error(`the fixture no longer contains ${needle}; the mutation would be a no-op`)
  process.exit(1)
}
writeFileSync(file, text.replace(needle, ''))
