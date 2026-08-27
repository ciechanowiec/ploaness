// The Payload-specific gates: the generated artefacts must match the configuration that produces them,
// and the Local API must be used in a way that neither over-fetches nor skips access control.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  findPayloadViolations,
  findSourceViolations,
  GENERATED_ARTEFACTS,
  type PayloadViolation,
} from '@ploaness/governance'
import { type Context, git, type Member, resolveProjectTool, trackedFiles } from '../context.js'
import { asFindings, failed, type GateResult, passed, type RunResult, runNode } from '../exec.js'

// Declared once in governance, so the regeneration gate and the write-denial gate cannot disagree
// about which artefacts are generated. They did: the schema file was denied by neither and diffed by
// neither, so a hand edit to it passed.
const GENERATED_PATHS: readonly string[] = GENERATED_ARTEFACTS

// Resolution failure is an answer rather than an exception the caller must catch.
const resolveProjectToolOrUndefined = (context: Context, tool: string): string | undefined => {
  try {
    return resolveProjectTool(context, tool)
  } catch {
    return undefined
  }
}

/** Regenerate the Payload types and admin import map, then fail on any drift. */
export const payloadGenerated = (context: Context): GateResult => {
  const payloadCli: string | undefined = resolveProjectToolOrUndefined(context, 'payload')
  if (payloadCli === undefined) {
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

// The language rules apply to every package; the Payload ones only to a package that has Payload to
// misuse. Held together, the import rule ran only where Payload did - so a frontend beside the CMS, the
// place a parent-relative import is MOST likely because it has no Payload config to anchor on, was the
// one package never checked for it.
const violationsIn = (source: string, isPayload: boolean): readonly PayloadViolation[] => [
  ...findSourceViolations(source),
  ...(isPayload ? findPayloadViolations(source) : []),
]

/** Apply the source rules to every tracked TypeScript file under the declared source roots. */
export const payloadRules = (context: Member): GateResult => {
  const roots: readonly string[] = context.settings.sourceRoots
  const candidates: readonly string[] = trackedFiles(context.root).filter(
    (file: string): boolean =>
      SOURCE_EXTENSIONS.some((extension: string): boolean => file.endsWith(extension)) &&
      roots.some((root: string): boolean => file.startsWith(`${root}/`)) &&
      !file.endsWith('payload-types.ts') &&
      existsSync(path.join(context.root, file)),
  )
  const findings: readonly string[] = candidates.flatMap((file: string): readonly string[] =>
    violationsIn(readFileSync(path.join(context.root, file), 'utf8'), context.isPayload).map(
      (violation: PayloadViolation): string =>
        `${file}:${String(violation.line)} [${violation.rule}] ${violation.reason}`,
    ),
  )
  return findings.length > 0
    ? failed(`${String(findings.length)} source usage violation(s)`, findings)
    : passed(`${String(candidates.length)} source file(s) follow the usage rules`)
}
