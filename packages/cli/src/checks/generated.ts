// Write denial for the generated Payload artefacts. The decision lives in governance; this reads the
// runtime settings file and, on the sync path, writes it back.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { applyDenyRules, findDenialViolations, GENERATED_ARTEFACTS } from '@ploaness/governance'
import type { Context } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

// Matches the indent the shipped formatter settings declare.
const JSON_INDENT: number = 2
const SETTINGS_PATH: string = '.claude/settings.json'
const LOCAL_SETTINGS_PATH: string = '.claude/settings.local.json'

const readJson = (root: string, relative: string): unknown => {
  const full: string = path.join(root, relative)
  if (!existsSync(full)) {
    return undefined
  }
  try {
    return JSON.parse(readFileSync(full, 'utf8'))
  } catch {
    return undefined
  }
}

/** Check that the agent runtime is denied write access to every generated artefact. */
export const generatedDenial = (context: Context): GateResult => {
  const findings: readonly string[] = findDenialViolations(
    readJson(context.root, SETTINGS_PATH),
    readJson(context.root, LOCAL_SETTINGS_PATH),
    GENERATED_ARTEFACTS,
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
export const hasWrittenDenyRules = (context: Context): boolean => {
  const full: string = path.join(context.root, SETTINGS_PATH)
  const existing: unknown = readJson(context.root, SETTINGS_PATH)
  const merged: Record<string, unknown> = applyDenyRules(existing, GENERATED_ARTEFACTS)
  const text: string = `${JSON.stringify(merged, null, JSON_INDENT)}\n`
  if (existsSync(full) && readFileSync(full, 'utf8') === text) {
    return false
  }
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, text)
  return true
}
