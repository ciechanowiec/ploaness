// Write denial for the generated Payload artefacts. The decision lives in governance; this reads the
// runtime settings file and, on the sync path, writes it back.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  applyDenyRules,
  deniedPathsFor,
  findDenialViolations,
  GENERATED_ARTEFACTS,
  type ParsedJson,
  parseJsonc,
} from '@ploaness/governance'
import type { Member, Repository } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

// Matches the indent the shipped formatter settings declare.
const JSON_INDENT: number = 2
const SETTINGS_PATH: string = '.claude/settings.json'
const LOCAL_SETTINGS_PATH: string = '.claude/settings.local.json'

/** A settings file that was read, was absent, or could not be parsed - which are three different facts. */
interface ReadSettings {
  readonly value: unknown
  /** True when the file exists but could not be read as JSON. */
  readonly isMalformed: boolean
}

// Absent and unparseable used to collapse into the same `undefined`, and `hasWrittenDenyRules` then
// merged its rules into that nothing and wrote the result. One stray comma in a project's settings and
// `ploaness sync` replaced every permission, hook, and environment entry the file held with the deny
// list alone. A tool may refuse to write; it may not quietly discard what it could not read.
const readSettings = (root: string, relative: string): ReadSettings => {
  const full: string = path.join(root, relative)
  if (!existsSync(full)) {
    return { value: undefined, isMalformed: false }
  }
  const read: ParsedJson = parseJsonc(readFileSync(full, 'utf8'))
  return { value: read.value, isMalformed: read.problem !== undefined }
}

const readJson = (root: string, relative: string): unknown => readSettings(root, relative).value

/** Check that the agent runtime is denied write access to every generated artefact. */
// The deny list is the union over Payload members of `<member>/<artefact>`. The runtime reads one
// settings file, at the repository root, while the artefacts are member-relative - so a rule written
// for one member would bind nothing in a workspace, and a gate per member would have several of them
// fighting over one file. For a single member at the root the union is the list that always shipped.
export const deniedArtefacts = (repository: Repository): readonly string[] =>
  deniedPathsFor(
    repository.members
      .filter((member: Member): boolean => member.isPayload)
      .map((member: Member): string => member.path),
    GENERATED_ARTEFACTS,
  )

export const generatedDenial = (context: Repository): GateResult => {
  const findings: readonly string[] = findDenialViolations(
    readJson(context.root, SETTINGS_PATH),
    readJson(context.root, LOCAL_SETTINGS_PATH),
    deniedArtefacts(context),
  )
  return findings.length > 0
    ? failed(`${String(findings.length)} generated file(s) are writable by an agent`, [
        ...findings,
        // Said plainly rather than implied: the rule binds the runtime that reads this file. The
        // standard scopes it the same way, so this is the whole of what the rule claims.
        `a denial in ${SETTINGS_PATH} binds the runtime that reads it; the regeneration gate ` +
          'remains the check that catches an edit made another way',
      ])
    : passed('every generated artefact is denied to an agent')
}

/**
 * Merge the required deny rules into the project's runtime settings.
 * @param context the resolved project environment.
 * @returns true when the file was created or changed.
 */
export const hasWrittenDenyRules = (context: Repository): boolean => {
  const full: string = path.join(context.root, SETTINGS_PATH)
  const existing: ReadSettings = readSettings(context.root, SETTINGS_PATH)
  if (existing.isMalformed) {
    throw new Error(
      `${SETTINGS_PATH} exists but is not valid JSON; repair it before running \`ploaness sync\`, ` +
        'because merging into a file that could not be read would discard everything it holds',
    )
  }
  const merged: Record<string, unknown> = applyDenyRules(existing.value, deniedArtefacts(context))
  const text: string = `${JSON.stringify(merged, null, JSON_INDENT)}\n`
  if (existsSync(full) && readFileSync(full, 'utf8') === text) {
    return false
  }
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, text)
  return true
}
