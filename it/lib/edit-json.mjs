// Sets one dot-separated key of a JSON file, used by the fixture cases to remove exactly one guarantee.
//
// It lived inside `verify.sh` as an argument to `node -e`, where it was a string as far as every tool
// was concerned: no formatter, no linter, and no type checker read a line of it. That is the same
// defect the staged asset bodies exist to close - code shipped where nothing can see it.
import { readFileSync, writeFileSync } from 'node:fs'

// node and this script's own path precede the caller's arguments.
const ARGUMENT_OFFSET = 2

// The indent every JSON file in this repository is written with.
const JSON_INDENT = 2

const [file, pointer, value] = process.argv.slice(ARGUMENT_OFFSET)
const parsed = JSON.parse(readFileSync(file, 'utf8'))
const keys = pointer.split('.')

// Creates a missing parent rather than crashing: a case that sets `ploaness.maxSuppressions` on a
// fixture that declares no `ploaness` key is setting it for the first time, which is the point.
const parentOf = (root) =>
  keys.slice(0, -1).reduce((cursor, key) => {
    if (typeof cursor[key] !== 'object' || cursor[key] === null) {
      cursor[key] = {}
    }
    return cursor[key]
  }, root)

// argv is text. A value that parses as JSON is stored as JSON, so a numeric ceiling of 0 is written as
// 0 and not as "0", which the settings reader would drop as malformed.
const asValue = (raw) => {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

parentOf(parsed)[keys.at(-1)] = asValue(value)
writeFileSync(file, `${JSON.stringify(parsed, null, JSON_INDENT)}\n`)
