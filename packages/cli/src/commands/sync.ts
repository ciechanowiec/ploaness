// `ploaness sync`: the only command that writes managed files. Everything else reads them.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { asRecord, type ParsedJson, parseJsonc, REQUIRED_SCRIPTS } from '@ploaness/governance'
import { type SyncChange, syncAssets } from '../checks/assets.js'
import { hasWrittenDenyRules } from '../checks/generated.js'
import type { Repository } from '../context.js'

// The indent every JSON file ploaness writes uses, matching the shipped formatter setting.
const JSON_INDENT: number = 2

const MANIFEST: string = 'package.json'

// The scripts ploaness owns, written at the repository root where `pnpm run verify` is invoked. Only
// those keys change, so the project's own scripts keep their order and their text. A manifest that does
// not parse is left for the wiring gate to report.
const syncScripts = (repository: Repository): readonly SyncChange[] => {
  const file: string = path.join(repository.root, MANIFEST)
  if (!existsSync(file)) {
    return []
  }
  const read: ParsedJson = parseJsonc(readFileSync(file, 'utf8'))
  if (read.problem !== undefined) {
    return []
  }
  const parsed: Record<string, unknown> = asRecord(read.value)
  const scripts: Record<string, unknown> = asRecord(parsed['scripts'])
  if (
    Object.entries(REQUIRED_SCRIPTS).every(([name, body]: readonly [string, string]): boolean => scripts[name] === body)
  ) {
    return []
  }
  const updated: Record<string, unknown> = { ...parsed, scripts: { ...scripts, ...REQUIRED_SCRIPTS } }
  writeFileSync(file, `${JSON.stringify(updated, null, JSON_INDENT)}\n`)
  return [{ path: `${MANIFEST} scripts`, action: 'wrote' }]
}

/** Materialise the managed files and the scripts ploaness owns, then report exactly what changed. */
export const sync = (repository: Repository): number => {
  // The write denial is repaired here rather than in `init` alone, because the gate that requires it
  // tells the project to run `ploaness sync`. A repair the advice cannot perform sends the project
  // round a loop, which is the one thing a managed-file finding must never do.
  const denialChange: readonly SyncChange[] = hasWrittenDenyRules(repository)
    ? [{ action: 'wrote', path: '.claude/settings.json' }]
    : []
  const changes: readonly SyncChange[] = [...syncScripts(repository), ...syncAssets(repository), ...denialChange]
  if (changes.length === 0) {
    console.info('ploaness sync: every managed path already matches the catalogue.')
    return 0
  }
  console.info(`ploaness sync: ${String(changes.length)} change(s)`)
  for (const change of changes) {
    console.info(`  ${change.action} ${change.path}`)
  }
  const refused: readonly SyncChange[] = changes.filter((change: SyncChange): boolean => change.action === 'refused')
  if (refused.length > 0) {
    console.error(
      `\n${String(refused.length)} file(s) carry duplicate, out-of-order, or non-leading ploaness markers.` +
        '\nRepair the markers by hand, then run `ploaness sync` again.',
    )
    return 1
  }
  console.info('\nReview these edits and commit them.')
  return 0
}
