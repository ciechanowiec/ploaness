// The gates that delegate to a tool. Each one points the tool at the ploaness-owned configuration rather
// than trusting a file in the consumer tree, because most of those files are FORBIDDEN paths: the
// project has no copy to drift from.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { type Context, readJson, resolveTool, shippedDirectory } from '../context.js'
import { failed, fromRun, type GateResult, passed, type RunResult, runNode } from '../exec.js'

const configFile = (name: string): string => path.join(shippedDirectory('@ploaness/config'), name)

/** Strict type checking against the project's tsconfig, which extends the ploaness one. */
export const types = (context: Context): GateResult =>
  fromRun(
    runNode(resolveTool('typescript', 'tsc'), ['--noEmit', '-p', 'tsconfig.json'], {
      cwd: context.root,
    }),
    'the project type-checks under the ploaness compiler options',
  )

/** Formatting and fast lint. */
export const biome = (context: Context): GateResult =>
  fromRun(
    runNode(resolveTool('@biomejs/biome', 'biome'), ['check', '.'], { cwd: context.root }),
    'Biome reports no formatting or lint defect',
  )

/** Apply Biome's own fixes, used by `ploaness format`. */
export const biomeWrite = (context: Context): RunResult =>
  runNode(resolveTool('@biomejs/biome', 'biome'), ['check', '--write', '.'], { cwd: context.root })

const SCHEMA_PATTERN: RegExp = /biomejs\.dev\/schemas\/(\d+\.\d+\.\d+)\/schema\.json/

// Biome reports a schema mismatch only as a non-failing information notice, so without this gate a Biome
// bump would leave the pinned `$schema` stale and silently out of date.
export const biomeSchema = (): GateResult => {
  const manifest: unknown = readJson(path.join(shippedDirectory('@biomejs/biome'), 'package.json'))
  const installed: string =
    typeof manifest === 'object' && manifest !== null
      ? String((manifest as Record<string, unknown>)['version'] ?? '')
      : ''
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

/** The type-aware lint layer, which catches what a syntax-only linter cannot. */
export const eslint = (context: Context): GateResult =>
  fromRun(runNode(resolveTool('eslint'), ['.'], { cwd: context.root }), 'ESLint reports no defect')

/** Style sheets. Biome remains the formatter, so Stylelint is lint-only. */
export const css = (context: Context): GateResult =>
  fromRun(
    runNode(
      resolveTool('stylelint'),
      ['--config', configFile('stylelint.json'), 'src/**/*.css', '--allow-empty-input'],
      { cwd: context.root },
    ),
    'style sheets pass Stylelint',
  )

/** Module architecture: layer boundaries, cycles, and import hygiene. */
export const architecture = (context: Context): GateResult =>
  fromRun(
    runNode(
      resolveTool('dependency-cruiser', 'depcruise'),
      ['src', '--config', configFile('dependency-cruiser.json')],
      { cwd: context.root },
    ),
    'module architecture holds',
  )

// Roles with no hand-written type surface to measure: framework glue, generated files, views, and
// configuration. Measuring them would dilute the score rather than sharpen it.
const TYPE_COVERAGE_IGNORE: readonly string[] = [
  '.next/**',
  'src/app/**',
  'src/**/*.tsx',
  'src/payload.config.ts',
  'src/payload-types.ts',
  'src/seed/**',
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
  )
