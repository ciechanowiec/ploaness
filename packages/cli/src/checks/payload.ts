// The Payload-specific gates: the generated artefacts must match the configuration that produces them,
// and the Local API must be used in a way that neither over-fetches nor skips access control.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  type DeclaredAdminView,
  findDeclaredAdminViews,
  findGeneratedDrift,
  findPayloadViolations,
  findSourceViolations,
  findUnguardedRelationships,
  findUnscannedAdminViews,
  type LocatedViolation,
  type PayloadViolation,
  type RegeneratedArtefact,
  type SpecSource,
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

const sourceCandidates = (context: Member): readonly string[] => {
  const roots: readonly string[] = context.settings.sourceRoots
  return workingTreeFiles(context.root).filter(
    (file: string): boolean =>
      SOURCE_EXTENSIONS.some((extension: string): boolean => file.endsWith(extension)) &&
      roots.some((root: string): boolean => file.startsWith(`${root}/`)) &&
      !file.endsWith('payload-types.ts') &&
      existsSync(path.join(context.root, file)),
  )
}

const reported = (file: string, violation: PayloadViolation): string =>
  `${file}:${String(violation.line)} [${violation.rule}] ${violation.reason}`

// One rule cannot be decided from a single file: a required relationship names its target by slug, and
// the collection carrying that slug is declared somewhere else. It therefore reads the whole candidate
// set rather than one text, and it reports the file that declares the relationship rather than the file
// it happens to be judged from.
const crossFileFindings = (context: Member, files: readonly SpecSource[]): readonly string[] =>
  context.isPayload
    ? findUnguardedRelationships(files).map((located: LocatedViolation): string =>
        reported(located.path, located.violation),
      )
    : []

/** Apply the source rules to every TypeScript file under the declared source roots. */
export const payloadRules = (context: Member): GateResult => {
  const candidates: readonly string[] = sourceCandidates(context)
  const files: readonly SpecSource[] = candidates.map(
    (file: string): SpecSource => ({
      path: file,
      source: readFileSync(path.join(context.root, file), 'utf8'),
    }),
  )
  const findings: readonly string[] = [
    ...files.flatMap((file: SpecSource): readonly string[] =>
      violationsIn(file.source, context.isPayload).map((violation: PayloadViolation): string =>
        reported(file.path, violation),
      ),
    ),
    ...crossFileFindings(context, files),
  ]
  return findings.length > 0
    ? failed(`${String(findings.length)} source usage violation(s)`, findings)
    : passed(`${String(candidates.length)} source file(s) follow the usage rules`)
}

// Where a project's specifications live. `tests/` is a ploaness convention rather than a project
// setting - the suite collects from `tests/unit`, `tests/int` and `tests/e2e`, and the sweeps ploaness
// pins are written to `tests/e2e` - so a scan written anywhere else would not run either.
const SPEC_ROOT: string = 'tests/'

/**
 * Every custom admin view is scanned for accessibility by a specification of the project's own.
 *
 * The pinned sweep skips the admin panel unconditionally, because the panel is Payload's markup and
 * the crawl carries no credential. A custom view is the project's markup behind that exemption, and
 * nothing else in the harness will ever look at it. ploaness cannot scan it - it cannot sign in, and
 * it does not know which container is the project's rather than the framework's - so it requires the
 * project to have scanned it instead.
 */
export const adminViews = (context: Member): GateResult => {
  const files: readonly SpecSource[] = sourceCandidates(context).map(
    (file: string): SpecSource => ({
      path: file,
      source: readFileSync(path.join(context.root, file), 'utf8'),
    }),
  )
  const specs: readonly SpecSource[] = files.filter((file: SpecSource): boolean =>
    file.path.startsWith(SPEC_ROOT),
  )
  // A configuration is looked for outside `tests/` alone, so that a fixture config written inside a
  // specification is not read as a view this project serves.
  const declared: readonly (readonly [SpecSource, readonly DeclaredAdminView[]])[] = files
    .filter((file: SpecSource): boolean => !file.path.startsWith(SPEC_ROOT))
    .map((file: SpecSource) => [file, findDeclaredAdminViews(file.source)] as const)
  const findings: readonly string[] = declared.flatMap(
    ([file, views]: readonly [SpecSource, readonly DeclaredAdminView[]]): readonly string[] =>
      findUnscannedAdminViews(views, specs, files).map(
        (violation: PayloadViolation): string =>
          `${file.path}:${String(violation.line)} [${violation.rule}] ${violation.reason}`,
      ),
  )
  if (findings.length > 0) {
    return failed(`${String(findings.length)} custom admin view(s) are not scanned`, findings)
  }
  const total: number = declared.reduce(
    (count: number, [, views]: readonly [SpecSource, readonly DeclaredAdminView[]]): number =>
      count + views.length,
    0,
  )
  return passed(
    total === 0
      ? 'this project declares no custom admin view'
      : `${String(total)} custom admin view(s) are scanned for accessibility`,
  )
}
