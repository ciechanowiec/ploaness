// The consuming project's declared settings, read once from the package.json in the working directory.
//
// Three shipped configurations need them - the Vitest config, the Playwright config, and the constants
// the managed accessibility sweep imports - and none of them may carry a second copy of this reader. A
// value the harness both writes and judges is declared once; the same holds for the value it reads.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { readSettings } from '@ploaness/governance'

// A project whose package.json cannot be read gets the defaults, which are the strict end of every
// setting. Failing to parse must never be the thing that loosens a threshold.
const readPackageJson = () => {
  try {
    return JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
  } catch {
    return {}
  }
}

export const projectSettings = readSettings(readPackageJson())
