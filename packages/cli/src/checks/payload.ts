// The Payload-specific gates: the generated artefacts must match the configuration that produces them,
// and the Local API must be used in a way that neither over-fetches nor skips access control.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  findGeneratedDrift,
  findPayloadViolations,
  findSourceViolations,
  type PayloadViolation,
  type RegeneratedArtefact,
} from '@ploaness/governance'
import {
  type Context,
  git,
  type Member,
  resolveProjectTool,
  runEnvironment,
  workingTreeFiles,
} from '../context.js'
import { asFindings, failed, type GateResult, passed, type RunResult, runNode } from '../exec.js'

// Resolution failure is an answer rather than an exception the caller must catch.
const resolveProjectToolOrUndefined = (context: Context, tool: string): string | undefined => {
  try {
    return resolveProjectTool(context, tool)
  } catch {
    return undefined
  }
}

const readIfPresent = (root: string, target: string): string | undefined => {
  const full: string = path.join(root, target)
  return existsSync(full) ? readFileSync(full, 'utf8') : undefined
}

// A repository is the normal case and git is required, so a failure here is an absent tool rather than
// an untracked artefact. Reported as tracked, which leaves the drift comparison - which needs no git at
// all - to answer on its own.
const isTracked = (context: Context, target: string): boolean => {
  try {
    return git(context, ['ls-files', '--', target]).length > 0
  } catch {
    return true
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
  // The SETTING rather than the constant behind it. Every other consumer of the artefact list already
  // read the setting - the write denials, the biome carve-outs, the scaffolder - and this one did not,
  // so a project that declared where its import map actually lives had that file denied, excluded, and
  // regenerated, but never diffed. The gate then reported that the artefacts matched a configuration it
  // had not compared them against, and the drift it had just written surfaced two gates later as an
  // unexplained working-tree change.
  const targets: readonly string[] = context.settings.generatedArtefacts
  // Read before the generators run, because they overwrite in place: this is the only moment the
  // previous bytes exist.
  const before: ReadonlyMap<string, string | undefined> = new Map(
    targets.map((target: string): readonly [string, string | undefined] => [
      target,
      readIfPresent(context.root, target),
    ]),
  )
  for (const target of ['generate:types', 'generate:importmap']) {
    const result: RunResult = runNode(payloadCli, [target], {
      cwd: context.root,
      // The project's own environment first, then the one option ploaness owns - so a `.env` cannot
      // silence the deprecation flag, and every other variable the configuration reads is present.
      env: { ...runEnvironment(context), NODE_OPTIONS: '--no-deprecation' },
    })
    if (result.code !== 0) {
      return failed(`payload ${target} failed`, asFindings(result.output))
    }
  }
  const regenerated: readonly RegeneratedArtefact[] = targets.map(
    (target: string): RegeneratedArtefact => ({
      target,
      isTracked: isTracked(context, target),
      before: before.get(target),
      after: readIfPresent(context.root, target),
    }),
  )
  const drifted: readonly string[] = findGeneratedDrift(regenerated)
  return drifted.length > 0
    ? failed('generated Payload artefacts drifted from the configuration', [
        ...drifted,
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

/** Apply the source rules to every TypeScript file under the declared source roots. */
export const payloadRules = (context: Member): GateResult => {
  const roots: readonly string[] = context.settings.sourceRoots
  const candidates: readonly string[] = workingTreeFiles(context.root).filter(
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
