// Removes one declared devDependency from a package.json.
import { readFileSync, writeFileSync } from 'node:fs'

const [file, name] = process.argv.slice(2)
const parsed = JSON.parse(readFileSync(file, 'utf8'))
delete parsed.devDependencies[name]
writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`)
