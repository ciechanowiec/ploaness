// The consuming project's declared settings, read once from the package.json in the working directory.
//
// Three shipped configurations need them - the Vitest config, the Playwright config, and the constants
// the managed accessibility sweep imports - and none of them may carry a second copy of this reader. A
// value the harness both writes and judges is declared once; the same holds for the value it reads.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { readSettings, type Settings } from '@ploaness/governance'

// A project whose package.json cannot be read gets the defaults, which are the strict end of every
// setting. Failing to parse must never be the thing that loosens a threshold.
// `unknown` rather than the parse's own `any`: `readSettings` narrows every field it reads, so handing
// it an `any` would only move the narrowing somewhere nothing checks it.
const readPackageJson = (): unknown => {
  const manifest: string = path.join(process.cwd(), 'package.json')
  try {
    return JSON.parse(readFileSync(manifest, 'utf8'))
  } catch {
    return {}
  }
}

export const projectSettings: Settings = readSettings(readPackageJson())
