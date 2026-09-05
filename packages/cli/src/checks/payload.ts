// The Payload-specific gates: the generated artefacts must match the configuration that produces them,
// and the Local API must be used in a way that neither over-fetches nor skips access control.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  type DeclaredAdminView,
  findDeclaredAdminViews,
  findEndpointViolations,
  findGeneratedDrift,
  findInheritedAccess,
  findPayloadViolations,
  findSourceViolations,
  findUnconstrainedDraftReads,
  findUnguardedRelationships,
  findUnscannedAdminViews,
  type InheritedAccessReport,
  type LocatedViolation,
  type PayloadViolation,
  parseInheritedAccessReport,
  payloadConfigPathOf,
  type RegeneratedArtefact,
  type SpecSource,
} from '@ploaness/governance'
import {
  type Context,
  cliDirectory,
  git,
  type Member,
  manifestPathFrom,
  readJson,
  resolveProjectTool,
  resolveTool,
  runEnvironment,
  workingTreeFiles,
} from '../context.js'
import {
  asFindings,
  failed,
  type GateResult,
  passed,
  type RunResult,
  runNode,
  withOutput,
} from '../exec.js'

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

// Where Payload keeps the function it fills an undeclared operation with. Named by path because the
// package's exports map does not expose it; ploaness pins `payload` exactly, so a layout change arrives
// with a ploaness release rather than silently, and an absent file fails closed below.
const DEFAULT_ACCESS_MODULE: readonly string[] = ['dist', 'auth', 'defaultAccess.js']
const PROBE_FILE: readonly string[] = ['dist', 'probes', 'payload-defaults.probe.js']
// Building a configuration opens no socket, but a plugin might, and a hung import must end as a verdict.
const PROBE_TIMEOUT_MS: number = 120_000

const defaultAccessFileOf = (context: Context): string | undefined => {
  const manifest: string | undefined = manifestPathFrom(
    'payload',
    path.join(context.root, 'package.json'),
  )
  return manifest === undefined
    ? undefined
    : path.join(path.dirname(manifest), ...DEFAULT_ACCESS_MODULE)
}

// The two defects the report can carry, named separately so the summary says which one was found
// rather than counting them together under whichever wording came first.
const summariseAccessFindings = (inherited: number, draftReads: number): string => {
  const parts: readonly string[] = [
    ...(inherited > 0
      ? [`${String(inherited)} collection(s) or global(s) inherit Payload's default access`]
      : []),
    ...(draftReads > 0
      ? [`${String(draftReads)} drafts read(s) serve an unapproved document to a stranger`]
      : []),
  ]
  return parts.join('; ')
}

// The probe's outcome, once it ran: a report that was not printed, or not readable, is a failure of its
// own rather than an empty finding list, because nothing else stands between a crashed probe and a pass.
const judgeProbe = (result: RunResult): GateResult => {
  if (result.code !== 0) {
    return failed('the Payload configuration could not be built', asFindings(result.output))
  }
  const report: InheritedAccessReport | undefined = parseInheritedAccessReport(result.stdout)
  if (report === undefined) {
    return failed('the access probe printed no readable report', asFindings(result.output))
  }
  const inherited: readonly string[] = findInheritedAccess(report)
  const draftReads: readonly string[] = findUnconstrainedDraftReads(report)
  const findings: readonly string[] = [...inherited, ...draftReads]
  return findings.length > 0
    ? failed(summariseAccessFindings(inherited.length, draftReads.length), findings)
    : passed(
        'every collection and global decides its access, framework-built ones included, and no ' +
          'drafts read serves an unapproved document to a stranger',
      )
}

/**
 * Every collection and global in the BUILT configuration decides its access.
 *
 * The static rule reads the access blocks a project wrote; this one imports the configuration Payload
 * actually boots, so the collections the framework builds for the project - the folder tree, the job
 * queue, a plugin's own - are judged too. Each of those arrives with Payload's default, which admits
 * every signed-in user, and the anonymous sweep cannot see that because a signed-in user is not
 * anonymous. The harness's own tsx loads the configuration against the project's tsconfig, with the
 * project root as the working directory so `payload` resolves from the project.
 */
export const payloadDefaults = (context: Member): GateResult => {
  const tsconfig: string = path.join(context.root, 'tsconfig.json')
  const configPath: string = payloadConfigPathOf(readJson(tsconfig))
  const configFile: string = path.join(context.root, configPath)
  if (!existsSync(configFile)) {
    return failed('the Payload configuration could not be found', [
      `${configPath} does not exist; a Payload member names its configuration under ` +
        'compilerOptions.paths["@payload-config"] in tsconfig.json, which `ploaness init` writes',
    ])
  }
  const defaultAccessFile: string | undefined = defaultAccessFileOf(context)
  if (defaultAccessFile === undefined) {
    return failed('payload could not be resolved from the project', [
      'ploaness governs Payload projects, so "payload" must be installed in the project itself',
    ])
  }
  if (!existsSync(defaultAccessFile)) {
    return failed("Payload's default access could not be located", [
      `${defaultAccessFile} is missing; ploaness knows the layout of the Payload version it pins, ` +
        'and this installation differs',
    ])
  }
  const result: RunResult = runNode(
    resolveTool('tsx'),
    [
      '--tsconfig',
      tsconfig,
      path.join(cliDirectory(), ...PROBE_FILE),
      configFile,
      defaultAccessFile,
    ],
    {
      cwd: context.root,
      // The placeholders every analyzer that imports the project receives, then the project's own
      // environment, then the one option ploaness owns: the same layering the knip and generated gates
      // use, so a configuration that validates `process.env` on import survives here as it does there.
      env: {
        ...context.settings.analysisEnv,
        ...runEnvironment(context),
        NODE_OPTIONS: '--no-deprecation',
      },
      timeoutMs: PROBE_TIMEOUT_MS,
    },
  )
  return withOutput(judgeProbe(result), result.output)
}

const SOURCE_EXTENSIONS: readonly string[] = ['.ts', '.tsx']

// The language rules apply to every package; the Payload ones only to a package that has Payload to
// misuse. Held together, the import rule ran only where Payload did - so a frontend beside the CMS, the
// place a parent-relative import is MOST likely because it has no Payload config to anchor on, was the
// one package never checked for it.
const violationsIn = (file: SpecSource, isPayload: boolean): readonly PayloadViolation[] => [
  ...findSourceViolations(file.source),
  ...(isPayload ? findPayloadViolations(file.source) : []),
  ...(isPayload ? findEndpointViolations(file.path, file.source) : []),
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
      violationsIn(file, context.isPayload).map((violation: PayloadViolation): string =>
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
