// The consuming project's declared settings, read once from the package.json in the working directory.
//
// Three shipped configurations need them - the Vitest config, the Playwright config, and the constants
// the managed accessibility sweep imports - and none of them may carry a second copy of this reader. A
// value the harness both writes and judges is declared once; the same holds for the value it reads.
//
// In a workspace the answer is TWO blocks rather than one. A member declares its own settings and the
// repository root declares the ones every member inherits, and the CLI layers them through
// `readMemberSettings` before any gate sees them. Reading only the member's block here left the
// shipped configurations disagreeing with every gate about the same project: a skip route declared at
// the root reached the gates and not the sweep, so the crawl followed a prefix it had been told to
// leave alone. The layering is one-directional, exactly as it is in the CLI - a list adds, a threshold
// is honoured only when stricter - so a member can never widen what the root set.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  ploanessBlock,
  readMemberSettings,
  readSettings,
  type Settings,
} from '@ploaness/governance'

// A project whose package.json cannot be read gets the defaults, which are the strict end of every
// setting. Failing to parse must never be the thing that loosens a threshold.
// `unknown` rather than the parse's own `any`: `readSettings` narrows every field it reads, so handing
// it an `any` would only move the narrowing somewhere nothing checks it.
const readPackageJson = (directory: string): unknown => {
  try {
    return JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
  } catch {
    return {}
  }
}

// What marks the repository root of a workspace. `pnpm-workspace.yaml` rather than `.git`, because it
// is the file that makes a directory a workspace root at all, and because a member checked out on its
// own is then correctly read as its own root rather than inheriting from whatever encloses it.
const WORKSPACE_MARKER: string = 'pnpm-workspace.yaml'

// Upwards from the member until the marker is found or the filesystem root is reached. Recursive
// rather than a loop, because this repository bans the mutable binding a loop would need.
const workspaceRootAbove = (directory: string): string | undefined => {
  const parent: string = path.dirname(directory)
  if (parent === directory) {
    return undefined
  }
  try {
    readFileSync(path.join(parent, WORKSPACE_MARKER), 'utf8')
    return parent
  } catch {
    return workspaceRootAbove(parent)
  }
}

const settingsFor = (member: string): Settings => {
  const own: unknown = readPackageJson(member)
  const repositoryRoot: string | undefined = workspaceRootAbove(member)
  if (repositoryRoot === undefined) {
    // The ordinary case: one package, which is its own repository. Layering a block onto itself would
    // append every additive list to a copy of itself rather than leaving it alone.
    return readSettings(own)
  }
  return readMemberSettings(ploanessBlock(readPackageJson(repositoryRoot)), ploanessBlock(own))
}

export const projectSettings: Settings = settingsFor(process.cwd())
