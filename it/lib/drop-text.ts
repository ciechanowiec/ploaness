// Removes the first occurrence of a needle from a file.
//
// A needle that is already absent exits non-zero rather than writing the file back unchanged: a
// mutation that changes nothing produces a fixture that passes for the wrong reason, and a suite of
// those reports green while testing nothing.
import { readFileSync, writeFileSync } from 'node:fs'

// node and this script's own path precede the caller's arguments.
const ARGUMENT_OFFSET: number = 2

const [file, needle]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (file === undefined || needle === undefined) {
  throw new Error('usage: drop-text.ts <file> <needle>')
}

const text: string = readFileSync(file, 'utf8')
if (!text.includes(needle)) {
  throw new Error(`the fixture no longer contains ${needle}; the mutation would be a no-op`)
}
writeFileSync(file, text.replace(needle, ''))
