// The Payload-specific gates: the generated artefacts must match the configuration that produces them,
// and the Local API must be used in a way that neither over-fetches nor skips access control.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  findPayloadViolations,
  findSourceViolations,
  type PayloadViolation,
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
      // The project's own environment first, then the one option ploaness owns - so a `.env` cannot
      // silence the deprecation flag, and every other variable the configuration reads is present.
      env: { ...runEnvironment(context), NODE_OPTIONS: '--no-deprecation' },
    })
    if (result.code !== 0) {
      return failed(`payload ${target} failed`, asFindings(result.output))
    }
  }
  // The SETTING rather than the constant behind it. Every other consumer of the artefact list already
  // read the setting - the write denials, the biome carve-outs, the scaffolder - and this one did not,
  // so a project that declared where its import map actually lives had that file denied, excluded, and
  // regenerated, but never diffed. The gate then reported that the artefacts matched a configuration it
  // had not compared them against, and the drift it had just written surfaced two gates later as an
  // unexplained working-tree change.
  const drifted: readonly string[] = context.settings.generatedArtefacts.flatMap(
    (target: string): readonly string[] => {
      if (!existsSync(path.join(context.root, target))) {
        return []
      }
      try {
        // Two questions, because `git diff` answers only one of them. It compares what git already
        // knows about, so an artefact that has never been committed produces no diff and reads as
        // agreement - which is the loudest possible silence: the file regenerating from a
        // configuration nobody can review, in a repository that does not contain it. Asked first,
        // because "it drifted" would be a strange thing to say about a file git has never seen.
        if (git(context, ['ls-files', '--', target]).length === 0) {
          return [
            `${target} is not tracked by git, so no committed version exists to compare against`,
          ]
        }
        return git(context, ['diff', '--name-only', '--', target]).length > 0
          ? [`${target} changed when regenerated`]
          : []
      } catch {
        return []
      }
    },
  )
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
