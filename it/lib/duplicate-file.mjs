// Appends a file to itself.
//
// It reads the file fully before writing, because a shell append that redirects a file into itself
// never terminates: the redirect keeps extending the very file the reader is still consuming.
import { readFileSync, writeFileSync } from 'node:fs'

// node and this script's own path precede the caller's arguments.
const ARGUMENT_OFFSET = 2

const [file] = process.argv.slice(ARGUMENT_OFFSET)
const text = readFileSync(file, 'utf8')
writeFileSync(file, `${text}\n${text}`)
