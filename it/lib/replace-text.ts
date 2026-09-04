// Replace one exact needle in a fixture file with a replacement, for a case that has to ADD something
// the template does not carry. Refuses a needle the file no longer contains, for the reason
// `drop-text.ts` does: a mutation that matched nothing would be a case that proves nothing.
import { readFileSync, writeFileSync } from 'node:fs'

const ARGUMENT_OFFSET: number = 2

const [file, needle, replacement]: readonly (string | undefined)[] =
  process.argv.slice(ARGUMENT_OFFSET)
if (file === undefined || needle === undefined || replacement === undefined) {
  throw new Error('usage: replace-text.ts <file> <needle> <replacement>')
}

const text: string = readFileSync(file, 'utf8')
if (!text.includes(needle)) {
  throw new Error(`the fixture no longer contains ${needle}; the mutation would be a no-op`)
}
// A function rather than the string, so a `$` in the replacement is text and not a pattern reference.
writeFileSync(
  file,
  text.replace(needle, (): string => replacement),
)
