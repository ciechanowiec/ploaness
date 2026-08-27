// The gates that delegate to a tool. Each one points the tool at the ploaness-owned configuration rather
// than trusting a file in the consumer tree, because most of those files are FORBIDDEN paths: the
// project has no copy to drift from.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { asRecord, type MemberKind, memberKindOf, pureLogicRule } from '@ploaness/governance'
import { type Context, type Member, readJson, resolveTool, shippedDirectory } from '../context.js'
import { failed, fromRun, type GateResult, passed, type RunResult, runNode } from '../exec.js'

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

// `--error-on-warnings` for the reason the Stylelint invocation below carries `--max-warnings=0`: a
// check has two verdicts, and a diagnostic Biome ranks as a warning would otherwise print and exit 0.
/** Formatting and fast lint. */
export const biome = (context: Context): GateResult =>
  fromRun(
    runNode(resolveTool('@biomejs/biome', 'biome'), ['check', '--error-on-warnings', '.'], {
      cwd: context.root,
    }),
    'Biome reports no formatting or lint defect',
    'Biome reports a formatting or lint defect',
  )

/** Apply Biome's own fixes, used by `ploaness format`. */
export const biomeWrite = (context: Context): RunResult =>
  runNode(resolveTool('@biomejs/biome', 'biome'), ['check', '--write', '.'], { cwd: context.root })

const versionOf = (manifest: Record<string, unknown>): string =>
  typeof manifest['version'] === 'string' ? manifest['version'] : ''

const SCHEMA_PATTERN: RegExp = /biomejs\.dev\/schemas\/(\d+\.\d+\.\d+)\/schema\.json/

// Biome reports a schema mismatch only as a non-failing information notice, so without this gate a Biome
// bump would leave the pinned `$schema` stale and silently out of date.
export const biomeSchema = (): GateResult => {
  const manifest: unknown = readJson(path.join(shippedDirectory('@biomejs/biome'), 'package.json'))
  const installed: string = versionOf(asRecord(manifest))
  const declared: string | undefined = SCHEMA_PATTERN.exec(
    readFileSync(configFile('biome.json'), 'utf8'),
  )?.[1]
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

// `--max-warnings=0` is the backstop behind the severity escalation in `eslint-core.js`. That
// escalation raises what the current presets declare; this flag fails the build on a warning whatever
// its source, including a preset added later whose severities nobody re-read.
/** The type-aware lint layer, which catches what a syntax-only linter cannot. */
export const eslint = (context: Context): GateResult =>
  fromRun(
    runNode(resolveTool('eslint'), ['.', '--max-warnings=0'], { cwd: context.root }),
    'ESLint reports no defect',
    'ESLint reports at least one defect',
  )

// `--max-warnings=0` because the shipped config asks Stylelint to report a descriptionless, needless, or
// wrongly scoped disable, and Stylelint reports those at warning severity. A warning severity does not
// exist here: any finding is a failure.
const stylesheetGlobs = (context: Context): readonly string[] =>
  context.settings.sourceRoots.map((sourceRoot: string): string => `${sourceRoot}/**/*.css`)

/** Style sheets. Biome remains the formatter, so Stylelint is lint-only. */
export const css = (context: Context): GateResult =>
  fromRun(
    runNode(
      resolveTool('stylelint'),
      [
        '--config',
        configFile('stylelint.json'),
        ...stylesheetGlobs(context),
        '--allow-empty-input',
        '--max-warnings=0',
      ],
      { cwd: context.root },
    ),
    'style sheets pass Stylelint',
    'a style sheet does not pass Stylelint',
  )

/** Module architecture: layer boundaries, cycles, and import hygiene. */
// The layer map is rendered rather than shipped, because the pure-logic floor is the one genuinely
// project-shaped part of the contract and a governed project may not own the analyzer's config file to
// state it. Written outside the working tree, so a verification run still writes nothing a fingerprint
// would notice, and pointed at the shipped rules by absolute path so the relative extends still resolves.
// Matches the indent every JSON file ploaness writes.
const JSON_INDENT: number = 2

const architectureConfig = (context: Context, kind: MemberKind): string => {
  const shipped: string = configFile(
    kind === 'library' ? 'dependency-cruiser-core.json' : 'dependency-cruiser.json',
  )
  const floor: Record<string, unknown> | undefined = pureLogicRule(context.settings.pureLogicRoots)
  if (floor === undefined) {
    return shipped
  }
  const directory: string = mkdtempSync(path.join(tmpdir(), 'ploaness-arch-'))
  const rendered: string = path.join(directory, 'dependency-cruiser.json')
  writeFileSync(
    rendered,
    `${JSON.stringify({ extends: shipped, forbidden: [floor] }, null, JSON_INDENT)}\n`,
  )
  return rendered
}

const architectureArguments = (context: Member): readonly string[] => {
  const kind: MemberKind = memberKindOf(context.packageJson)
  return [...context.settings.sourceRoots, '--config', architectureConfig(context, kind)]
}

export const architecture = (context: Member): GateResult =>
  fromRun(
    runNode(
      resolveTool('dependency-cruiser', 'depcruise'),
      // Every declared source root, not `src` alone: the acyclic-dependency rule is about the
      // repository's dependency units, and a cycle through `scripts` or `tests` is still a cycle.
      architectureArguments(context),
      { cwd: context.root },
    ),
    'module architecture holds',
    'the module architecture contract is broken',
  )

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
        ...TYPE_COVERAGE_IGNORE.flatMap((pattern: string): readonly string[] => [
          '--ignore-files',
          pattern,
        ]),
      ],
      { cwd: context.root },
    ),
    'hand-written logic is fully typed',
    'some hand-written logic is not fully typed',
  )

/** Dead code, unused files, and unused dependencies. */
export const knip = (context: Context): GateResult =>
  fromRun(
    runNode(resolveTool('knip'), ['--config', configFile('knip.json')], {
      cwd: context.root,
      // knip traces the graph by importing the project, and a Payload config validates `process.env`
      // at module scope. Without placeholders the analysis dies on configuration rather than on code.
      env: context.settings.analysisEnv,
    }),
    'no dead code or unused dependency',
    'dead code or an unused dependency was found',
  )
