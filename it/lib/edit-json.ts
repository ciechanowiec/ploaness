// Sets one dot-separated key of a JSON file, used by the fixture cases to remove exactly one guarantee.
//
// It lived inside `verify.sh` as an argument to `node -e`, where it was a string as far as every tool
// was concerned: no formatter, no linter, and no type checker read a line of it. That is the same
// defect the staged asset bodies exist to close - code shipped where nothing can see it.
import { readFileSync, writeFileSync } from 'node:fs'
import { asRecord } from '@ploaness/governance'

// node and this script's own path precede the caller's arguments.
const ARGUMENT_OFFSET: number = 2

const [file, pointer, value]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (file === undefined || pointer === undefined || value === undefined) {
  throw new Error('usage: edit-json.ts <file> <dotted.key> <value>')
}

// The offset `slice` and `at` read to reach every key but the last, and the last one itself.
const LAST_KEY: number = -1

const parsed: Record<string, unknown> = asRecord(JSON.parse(readFileSync(file, 'utf8')))
const keys: readonly string[] = pointer.split('.')

// Creates a missing parent rather than crashing: a case that sets `ploaness.maxSuppressions` on a
// fixture that declares no `ploaness` key is setting it for the first time, which is the point.
const parentOf = (root: Record<string, unknown>): Record<string, unknown> =>
  keys
    .slice(0, LAST_KEY)
    .reduce((cursor: Record<string, unknown>, key: string): Record<string, unknown> => {
      const existing: unknown = cursor[key]
      if (typeof existing !== 'object' || existing === null) {
        cursor[key] = {}
      }
      return asRecord(cursor[key])
    }, root)

// argv is text. A value that parses as JSON is stored as JSON, so a numeric ceiling of 0 is written as
// 0 and not as "0", which the settings reader would drop as malformed.
const asValue = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

const lastKey: string | undefined = keys.at(LAST_KEY)
if (lastKey === undefined) {
  throw new Error(`the pointer "${pointer}" names no key`)
}
// The indent every JSON file in this repository is written with.
const JSON_INDENT: number = 2

parentOf(parsed)[lastKey] = asValue(value)
writeFileSync(file, `${JSON.stringify(parsed, null, JSON_INDENT)}\n`)
