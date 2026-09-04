// Adds one item into an EXISTING top-level list block of a pnpm workspace file.
//
// A program rather than `sed -i`, for the reason `add-override.ts` records: the two seds disagree
// about that flag, so an in-place edit that works on a workstation fails on the first push. Into the
// first block rather than appended as a second one, because pnpm reads the first key a file declares
// and a duplicate would be a defect the fixture never actually introduced.
//
// A block that is absent exits non-zero rather than writing the file back unchanged: a mutation that
// changes nothing produces a fixture that passes for the wrong reason.
import { readFileSync, writeFileSync } from 'node:fs'

// node and this script's own path precede the caller's arguments.
const ARGUMENT_OFFSET: number = 2

const [file, key, item]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (file === undefined || key === undefined || item === undefined) {
  throw new Error('usage: add-list-item.ts <pnpm-workspace.yaml> <key> <item>')
}

const BLOCK: string = `${key}:`
const ABSENT: number = -1

const lines: readonly string[] = readFileSync(file, 'utf8').split('\n')
const at: number = lines.indexOf(BLOCK)
if (at === ABSENT) {
  throw new Error(`${file} declares no ${BLOCK} block; the mutation would be a no-op`)
}

const after: number = at + 1
writeFileSync(file, [...lines.slice(0, after), `  - ${item}`, ...lines.slice(after)].join('\n'))
