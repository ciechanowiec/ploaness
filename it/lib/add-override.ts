// Adds a version override into a pnpm workspace file's EXISTING `overrides:` block.
//
// A program rather than `sed -i`, because the two seds disagree about that flag: BSD sed takes the
// backup suffix as a separate argument and GNU sed takes it attached, so `sed -i '' 's/x/y/' file`
// edits in place on a macOS workstation and makes GNU sed read the script as a filename. This suite
// ran green on a workstation for as long as nothing else ran it, and failed on its first push.
//
// A block that is absent exits non-zero rather than writing the file back unchanged, for the reason
// `drop-text.ts` records: a mutation that changes nothing produces a fixture that passes for the
// wrong reason.
import { readFileSync, writeFileSync } from 'node:fs'

// node and this script's own path precede the caller's arguments.
const ARGUMENT_OFFSET: number = 2

const [file, name, version]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (file === undefined || name === undefined || version === undefined) {
  throw new Error('usage: add-override.ts <pnpm-workspace.yaml> <package> <version>')
}

const BLOCK: string = 'overrides:'
const ABSENT: number = -1

const lines: readonly string[] = readFileSync(file, 'utf8').split('\n')
// Into the FIRST block rather than appended as a second one: pnpm reads the first `overrides:` a file
// declares, so a duplicate key would be a defect the fixture never actually introduced.
const at: number = lines.indexOf(BLOCK)
if (at === ABSENT) {
  throw new Error(`${file} declares no ${BLOCK} block; the mutation would be a no-op`)
}

const after: number = at + 1
writeFileSync(
  file,
  [...lines.slice(0, after), `  ${name}: ${version}`, ...lines.slice(after)].join('\n'),
)
