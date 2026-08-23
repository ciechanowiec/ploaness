// The Payload-specific gates: the generated artefacts must match the configuration that produces them,
// and the Local API must be used in a way that neither over-fetches nor skips access control.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { findPayloadViolations, type PayloadViolation } from '@ploaness/governance'
import { type Context, git, resolveProjectTool, trackedFiles } from '../context.js'
import { asFindings, failed, type GateResult, passed, type RunResult, runNode } from '../exec.js'

// The two artefacts Payload derives from the configuration. Committed drift means the admin panel and
// the type surface disagree with the collections that produced them.
const GENERATED_PATHS: readonly string[] = [
  'src/payload-types.ts',
  'src/app/(payload)/admin/importMap.js',
]

/** Regenerate the Payload types and admin import map, then fail on any drift. */
export const payloadGenerated = (context: Context): GateResult => {
  let payloadCli: string
  try {
    payloadCli = resolveProjectTool(context, 'payload')
  } catch {
    return failed('the payload CLI could not be resolved from the project', [
      'ploaness governs Payload projects, so "payload" must be installed in the project itself',
    ])
  }
  for (const target of ['generate:types', 'generate:importmap']) {
    const result: RunResult = runNode(payloadCli, [target], {
      cwd: context.root,
      env: { NODE_OPTIONS: '--no-deprecation' },
    })
    if (result.code !== 0) {
      return failed(`payload ${target} failed`, asFindings(result.output))
    }
  }
  const drifted: readonly string[] = GENERATED_PATHS.filter((target: string): boolean => {
    if (!existsSync(path.join(context.root, target))) {
      return false
    }
    try {
      return git(context, ['diff', '--name-only', '--', target]).length > 0
    } catch {
      return false
    }
  })
  return drifted.length > 0
    ? failed('generated Payload artefacts drifted from the configuration', [
        ...drifted.map((target: string): string => `${target} changed when regenerated`),
        'commit the regenerated files',
      ])
    : passed('the generated Payload artefacts match the configuration')
}

const SOURCE_EXTENSIONS: readonly string[] = ['.ts', '.tsx']

/** Apply the Payload source rules to every tracked TypeScript file under the declared source roots. */
export const payloadRules = (context: Context): GateResult => {
  const roots: readonly string[] = context.settings.sourceRoots
  const candidates: readonly string[] = trackedFiles(context.root).filter(
    (file: string): boolean =>
      SOURCE_EXTENSIONS.some((extension: string): boolean => file.endsWith(extension)) &&
      roots.some((root: string): boolean => file.startsWith(`${root}/`)) &&
      !file.endsWith('payload-types.ts') &&
      existsSync(path.join(context.root, file)),
  )
  const findings: string[] = []
  for (const file of candidates) {
    const source: string = readFileSync(path.join(context.root, file), 'utf8')
    for (const violation of findPayloadViolations(source)) {
      findings.push(`${file}:${violation.line} [${violation.rule}] ${violation.reason}`)
    }
  }
  return findings.length > 0
    ? failed(`${findings.length} Payload usage violation(s)`, findings)
    : passed(`${candidates.length} source file(s) use Payload within the rules`)
}

/** Expose the pure rule for the single-file case, so a fixture can assert on one source. */
export const payloadViolationsIn = (source: string): readonly PayloadViolation[] =>
  findPayloadViolations(source)
