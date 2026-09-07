// Read the consumer's settings from the working directory, where its tools are invoked.
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
