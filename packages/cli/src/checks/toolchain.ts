// The gates that delegate to a tool. Each one points the tool at the ploaness-owned configuration rather
// than trusting a file in the consumer tree, because most of those files are FORBIDDEN paths: the
// project has no copy to drift from.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  allowedJavaScriptFiles,
  analysisBoundaries,
  asRecord,
  biomeSelection,
  eslintArguments,
  importGraphOf,
  isArray,
  type MemberKind,
  memberKindOf,
  parseJsonc,
  pureLogicRule,
  requiredBiomeFiles,
} from '@ploaness/governance'
import {
  type Context,
  type Member,
  presentWorkingTreeFiles,
  readJson,
  resolveTool,
  shippedDirectory,
} from '../context.js'
import { asFindings, failed, fromRun, type GateResult, passed, type RunResult, runNode } from '../exec.js'

const configFile = (name: string): string => path.join(shippedDirectory('@ploaness/config'), name)

/** Strict type checking against the project's tsconfig, which extends the ploaness one. */
export const types = (context: Context): GateResult =>
  fromRun(
    runNode(resolveTool('typescript', 'tsc'), ['--noEmit', '-p', 'tsconfig.json'], {
      cwd: context.root,
    }),
    'the project type-checks under the ploaness compiler options',
    'the project does not type-check under the ploaness compiler options',
  )

const biomeRun = (context: Member, mode: '--write' | '--error-on-warnings'): RunResult => {
  const selection: Readonly<Record<string, unknown>> = requiredBiomeFiles(
    context.settings.sourceRoots,
    memberKindOf(context.packageJson),
    context.settings.generatedArtefacts,
  )
  const files: readonly string[] = biomeSelection(
    presentWorkingTreeFiles(context.root),
    stringEntries(selection['includes']),
    context.siblingPaths,
  )
  return files.length === 0
    ? { code: 0, output: 'no owned files selected for Biome', stdout: '' }
    : runNode(resolveTool('@biomejs/biome', 'biome'), ['check', mode, ...files], { cwd: context.root })
}

/** Formatting and fast lint, bounded to the current member's working-tree files. */
export const biome = (context: Member): GateResult =>
  fromRun(
    biomeRun(context, '--error-on-warnings'),
    'Biome reports no formatting or lint defect',
    'Biome reports a formatting or lint defect',
  )

/** Apply the same selection the Biome gate checks. */
export const biomeWrite = (context: Member): RunResult => biomeRun(context, '--write')

const versionOf = (manifest: Record<string, unknown>): string =>
  typeof manifest['version'] === 'string' ? manifest['version'] : ''

const SCHEMA_PATTERN: RegExp = /biomejs\.dev\/schemas\/(\d+\.\d+\.\d+)\/schema\.json/

// Biome reports a schema mismatch only as a non-failing information notice, so without this gate a Biome
// bump would leave the pinned `$schema` stale and silently out of date.
export const biomeSchema = (): GateResult => {
  const manifest: unknown = readJson(path.join(shippedDirectory('@biomejs/biome'), 'package.json'))
  const installed: string = versionOf(asRecord(manifest))
  const declared: string | undefined = SCHEMA_PATTERN.exec(readFileSync(configFile('biome.json'), 'utf8'))?.[1]
  if (declared === undefined) {
    return failed('the ploaness Biome config declares no $schema URL', [
      'this is a ploaness packaging defect; report it',
    ])
  }
  return declared === installed
    ? passed(`Biome $schema matches the installed CLI (${installed})`)
    : failed('the ploaness Biome $schema drifted from the installed CLI', [
        `$schema is ${declared} but @biomejs/biome is ${installed}`,
        'this is a ploaness packaging defect; report it',
      ])
}

// Which files the run covers is `eslintArguments`' to decide, so that the writing run below cannot
// answer it differently. What stays here is why this run renders a verdict at all: `--max-warnings=0` is
// the backstop behind the severity escalation in `eslint-core.js`. That escalation raises what the
// current presets declare; the flag fails the build on a warning whatever its source, including a preset
// added later whose severities nobody re-read.
/** The type-aware lint layer, which catches what a syntax-only linter cannot. */
export const eslint = (context: Member): GateResult =>
  fromRun(
    runNode(resolveTool('eslint'), [...eslintArguments(context.siblingPaths, 'report')], {
      cwd: context.root,
    }),
    'ESLint reports no defect',
    'ESLint reports at least one defect',
  )

/**
 * The same run with its fixable rules applied, used by `ploaness format`.
 *
 * It lives beside the gate that judges what it writes, for the reason `biomeWrite` does: the two must
 * not disagree about which files the tool touches, and the arguments they share say so in one place.
 */
export const eslintWrite = (context: Member): RunResult =>
  runNode(resolveTool('eslint'), [...eslintArguments(context.siblingPaths, 'fix')], {
    cwd: context.root,
  })

export { css } from './stylesheets.js'

/** Module architecture: layer boundaries, cycles, and import hygiene. */
// The layer map is rendered rather than shipped, because the pure-logic floor is the one genuinely
// project-shaped part of the contract and a governed project may not own the analyzer's config file to
// state it. Written outside the working tree, so a verification run still writes nothing a fingerprint
// would notice, and pointed at the shipped rules by absolute path so the relative extends still resolves.
// Matches the indent every JSON file ploaness writes.
const JSON_INDENT: number = 2

const architectureConfig = (context: Context, kind: MemberKind): string => {
  const shipped: string = configFile(kind === 'library' ? 'dependency-cruiser-core.json' : 'dependency-cruiser.json')
  const floor: Record<string, unknown> | undefined = pureLogicRule(
    context.settings.pureLogicRoots,
    context.settings.sourceRoots,
  )
  if (floor === undefined) {
    return shipped
  }
  const directory: string = mkdtempSync(path.join(tmpdir(), 'ploaness-arch-'))
  const rendered: string = path.join(directory, 'dependency-cruiser.json')
  writeFileSync(rendered, `${JSON.stringify({ extends: shipped, forbidden: [floor] }, null, JSON_INDENT)}\n`)
  return rendered
}

// Every declared source root, not `src` alone: the acyclic-dependency rule is about the package's
// dependency units, and a cycle through `scripts` or `tests` is still a cycle. Only the roots that
// EXIST, though - the analyzer refuses a directory it cannot open, so a package holding shared scripts
// and no `src` failed on the shape of its own layout rather than on anything about its architecture.
const presentSourceRoots = (context: Member): readonly string[] =>
  context.settings.sourceRoots.filter((root: string): boolean => existsSync(path.join(context.root, root)))

const cruise = (context: Member, roots: readonly string[], options: readonly string[] = []): RunResult =>
  runNode(
    resolveTool('dependency-cruiser', 'depcruise'),
    [...roots, '--config', architectureConfig(context, memberKindOf(context.packageJson)), ...options],
    { cwd: context.root },
  )

export const architecture = (context: Member): GateResult => {
  const roots: readonly string[] = presentSourceRoots(context)
  if (roots.length === 0) {
    return passed('this package holds no source directory to cruise')
  }
  return fromRun(cruise(context, roots), 'module architecture holds', 'the module architecture contract is broken')
}

/**
 * The member's import graph, as the architecture gate's analyzer resolves it from the same roots under
 * the same configuration: path aliases, type-only imports and stylesheet modules included.
 * @param context the member.
 * @returns each module, relative to the member root, and the modules it imports; or the failure.
 */
export const importGraph = (context: Member): Readonly<Record<string, readonly string[]>> | GateResult => {
  const roots: readonly string[] = presentSourceRoots(context)
  if (roots.length === 0) {
    return {}
  }
  const result: RunResult = cruise(context, roots, ['--output-type', 'json'])
  const graph: Readonly<Record<string, readonly string[]>> | undefined = importGraphOf(parseJsonc(result.stdout).value)
  return graph ?? failed('the import graph could not be read', asFindings(result.output))
}

// Roles with no hand-written type surface to measure: framework glue, generated files, views, and
// configuration. Measuring them would dilute the score rather than sharpen it.
//
// This list must never become empty, for a reason beyond what it names. type-coverage also reads a
// `typeCoverage` key from the consumer's package.json, which ploaness does not police - and does not
// need to, because a CLI `--ignore-files` REPLACES that key's `ignoreFiles` rather than merging with
// it. Measured: with these flags the score is identical whether or not a consumer declares
// `typeCoverage.ignoreFiles: ["src/**", "scripts/**"]`. Passing no `--ignore-files` would hand the
// consumer that key back, which is a scope narrowing the harness is supposed to refuse.
const TYPE_COVERAGE_IGNORE: readonly string[] = [
  '.next/**',
  'src/app/**',
  'src/**/*.tsx',
  'src/payload.config.ts',
  'src/payload-types.ts',
  'src/seed/**',
  // Test code is held to tsc at full strictness, to every ESLint rule, and to the coverage floors -
  // the static-analysis checks the standard means. Type coverage is a different measurement: with
  // `--strict` it counts every type assertion as uncovered, and a test's job is to construct inputs
  // the production types cannot express. A Payload access predicate takes a full PayloadRequest, so
  // asserting a partial one is the correct way to test the predicate, and the only way to reach 100%
  // here would be to build framework objects nobody reads. This is a file role, not a convenience.
  'tests/**',
  '*.config.ts',
  '*.config.mts',
  '*.config.mjs',
  'vitest.setup.ts',
]

/** Full type coverage on hand-written logic: no implicit or explicit `any` survives. */
export const typeCoverage = (context: Context): GateResult =>
  fromRun(
    runNode(
      resolveTool('type-coverage'),
      [
        '--at-least',
        '100',
        '--strict',
        '--cache',
        'false',
        ...[
          ...new Set([
            ...TYPE_COVERAGE_IGNORE,
            ...context.settings.generatedArtefacts,
            ...context.settings.frameworkGlue,
          ]),
        ].flatMap((pattern: string): readonly string[] => ['--ignore-files', pattern]),
      ],
      { cwd: context.root },
    ),
    'hand-written logic is fully typed',
    'some hand-written logic is not fully typed',
  )

/** Dead code, unused files, and unused dependencies. */
// The member boundary `analysisBoundaries` states, reaching knip. It takes the patterns as configuration
// rather than as a flag, and its own config is a shipped file a project may not edit - so the boundary
// has to be rendered into a copy for the run rather than passed on the command line as ESLint's is.
const stringEntries = (value: unknown): readonly string[] =>
  isArray(value) ? value.filter((entry: unknown): entry is string => typeof entry === 'string') : []

// A generated artefact is ignored as ESLint ignores it: its generator owns it, so a file nothing imports,
// such as the script a static export ships for a browser, is not dead code a project could remove.
/**
 * The knip configuration of one run: the shipped file, or a copy that adds the member's boundaries, its
 * allowlisted JavaScript as entries, and its generated artefacts as ignored.
 * @param context the member being judged.
 * @returns the path of the configuration file.
 */
export const knipConfig = (context: Member): string => {
  const boundaries: readonly string[] = analysisBoundaries(context.siblingPaths)
  const generated: readonly string[] = context.settings.generatedArtefacts
  const entries: readonly string[] = allowedJavaScriptFiles(
    presentWorkingTreeFiles(context.root),
    context.settings.javascriptAllowlist,
    context.siblingPaths,
  )
  if (boundaries.length === 0 && entries.length === 0 && generated.length === 0) {
    return configFile('knip.json')
  }
  const shipped: Record<string, unknown> = asRecord(readJson(configFile('knip.json')))
  const directory: string = mkdtempSync(path.join(tmpdir(), 'ploaness-knip-'))
  const rendered: string = path.join(directory, 'knip.json')
  writeFileSync(
    rendered,
    `${JSON.stringify(
      {
        ...shipped,
        entry: [...stringEntries(shipped['entry']), ...entries],
        ignore: [...stringEntries(shipped['ignore']), ...boundaries, ...generated],
      },
      null,
      JSON_INDENT,
    )}\n`,
  )
  return rendered
}

export const knip = (context: Member): GateResult =>
  fromRun(
    runNode(resolveTool('knip'), ['--config', knipConfig(context)], {
      cwd: context.root,
      // knip traces the graph by importing the project, and a Payload config validates `process.env`
      // at module scope. Without placeholders the analysis dies on configuration rather than on code.
      env: context.settings.analysisEnv,
    }),
    'no dead code or unused dependency',
    'dead code or an unused dependency was found',
  )
