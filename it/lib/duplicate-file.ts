// Appends a file to itself.
//
// It reads the file fully before writing, because a shell append that redirects a file into itself
// never terminates: the redirect keeps extending the very file the reader is still consuming.
import { readFileSync, writeFileSync } from 'node:fs'

// node and this script's own path precede the caller's arguments.
const ARGUMENT_OFFSET: number = 2

const [file]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (file === undefined) {
  throw new Error('usage: duplicate-file.ts <file>')
}

const text: string = readFileSync(file, 'utf8')
writeFileSync(file, `${text}\n${text}`)
