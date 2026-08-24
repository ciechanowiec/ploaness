// Appends a file to itself.
//
// It reads the file fully before writing, because a shell append that redirects a file into itself
// never terminates: the redirect keeps extending the very file the reader is still consuming.
import { readFileSync, writeFileSync } from 'node:fs'

const [file] = process.argv.slice(2)
const text = readFileSync(file, 'utf8')
writeFileSync(file, `${text}\n${text}`)
