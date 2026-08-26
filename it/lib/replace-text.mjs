// Replaces the first occurrence of a needle in a file with a replacement.
//
// `drop-text.mjs` can only remove, which turns a rule that judges a VALUE into a case that cannot be
// written: dropping `create: (): boolean => false` leaves a collection missing an operation, so the
// fixture would fail the completeness rule instead of the one under test. This program flips the value
// and leaves everything around it alone.
//
// A needle that is already absent exits non-zero rather than writing the file back unchanged, for the
// reason drop-text.mjs gives: a mutation that changes nothing produces a fixture that passes for the
// wrong reason.
import { readFileSync, writeFileSync } from 'node:fs'

// node and this script's own path precede the caller's arguments.
const ARGUMENT_OFFSET = 2

const [file, needle, replacement] = process.argv.slice(ARGUMENT_OFFSET)
const text = readFileSync(file, 'utf8')
if (!text.includes(needle)) {
  throw new Error(`the fixture no longer contains ${needle}; the mutation would be a no-op`)
}
// A replacer FUNCTION rather than a string: a replacement string is scanned for `$&` and its
// relatives, so a fixture mutation carrying one would insert something nobody wrote.
writeFileSync(
  file,
  text.replace(needle, () => replacement),
)
