import { findSilencedAdvisories } from './install-policy.js'
import { type DeclaredExclusion, findConvenienceExclusions } from './settings.js'
import { declaredDependencies, findVersionViolations } from './version-policy.js'
import type { WiringViolation } from './wiring-violation.js'
// Anti-bypass policy: the module that exists because npm has no lifecycle.
//
// A build tool that bound its checks to fixed phases would make this unnecessary: the checks would run
// because the build ran, and the harness would only have to stop a project redeclaring them away. npm
// binds nothing. A `package.json` script is a consumer-owned string, so a project (or an agent working in
// it) can rewrite `verify` to `echo ok`, append a rule-disabling block to the flat ESLint config, or swap
// the configuration a tool reads, and nothing downstream would notice.
//
// So ploaness makes its own installation a governed domain. This module holds the pure rules; the gate
// that reads the files lives in the CLI. It cannot make bypass impossible, since a project can always
// uninstall the dependency, but it makes bypass loud and deliberate rather than silent, which is the
// property a fixed build lifecycle would have supplied for free.
//
// What this module deliberately does NOT rule on is where verification runs. It once required a workflow
// invoking extended verification, and refused `--enforce=false` and `continue-on-error` around it. The
// governing standard states no such rule: it says the head commit of the main branch passes the
// verification command, and leaves the mechanism to the project. A rule the standard does not state is
// ploaness dictating a hosting platform, so it is gone rather than kept for being useful.

/** The consumer files the wiring gate reads, injected so the core stays free of filesystem access. */
export interface WiringInputs {
  readonly packageJson: unknown
  readonly eslintConfig: string | undefined
  /** The project's vitest config. The tests gate runs the project's vitest against it. */
  readonly vitestConfig: string | undefined
  /**
   * The project's Playwright config. Required rather than optional: ploaness ships the accessibility
   * sweep as a managed spec, so every project has an end-to-end suite and something must run it.
   */
  readonly playwrightConfig: string | undefined
  /** The contents of pnpm-workspace.yaml, or an empty string when the project ships none. */
  readonly workspaceFile: string
  /** Every exclusion the project declared, so the gate can refuse one that narrows by convenience. */
  readonly declaredExclusions: readonly DeclaredExclusion[]
  readonly biomeConfig: string | undefined
  readonly tsconfig: string | undefined
  /**
   * Test-authoring libraries the consumer's own specs import, mapped to the version ploaness was built
   * against. The CLI reads these from the ploaness config package rather than hard-coding them here, so
   * a harness bump moves the expectation in one place.
   */
  readonly expectedTestLibraries: Readonly<Record<string, string>>
  /** The subset every project must declare, because its own specs import them. */
  readonly requiredTestLibraries: ReadonlySet<string>
  /**
   * The exact version every `@payloadcms/*` package must carry, which is the pinned `payload` version.
   * Derived from the pin rather than enumerated, so a project that adds a Payload plugin is covered
   * without ploaness listing it.
   */
  readonly payloadVersion: string | undefined
  /**
   * The exact `packageManager` field the project must declare. The package manager resolves the whole
   * dependency graph, so it is the one piece of toolchain that decides what every other pin means.
   */
  readonly requiredPackageManager: string | undefined
  /** The `engines` block the project must declare, so a project states the runtime ploaness requires. */
  readonly requiredEngines: Readonly<Record<string, string>>
  /** The `files` block the consumer's biome.json must declare, from {@link requiredBiomeFiles}. */
  readonly requiredBiomeFiles: Readonly<Record<string, unknown>>
}

/** The exact script bodies ploaness owns. The consumer declares the name; ploaness dictates the command. */
export const REQUIRED_SCRIPTS: Readonly<Record<string, string>> = {
  verify: 'ploaness verify',
  'verify:full': 'ploaness verify --extended',
  format: 'ploaness format',
}

/**
 * The specifier a consumer biome.json must extend. Declared once here rather than written as a literal
 * in both the rule and the scaffolder that writes the file the rule judges, so the two cannot drift.
 */
export const REQUIRED_BIOME_EXTENDS: string = 'ploaness/biome'

/**
 * The specifier a consumer tsconfig.json must extend: the literal file path, not the bare
 * `ploaness/tsconfig` package specifier. TypeScript honours both, but a Payload project is also parsed
 * by Next.js, which does not read a package exports map and fails on the bare form. Requiring the path
 * that works everywhere is the difference between `tsc` passing and `next build` dying on a config it
 * cannot resolve.
 */
export const REQUIRED_TSCONFIG_EXTENDS: string = 'ploaness/tsconfig.json'

/**
 * The `files` block a consumer's biome.json must carry verbatim.
 *
 * File selection cannot live in the shared config the way rule configuration does. Biome resolves a
 * relative glob against the directory of the config that declares it, and the shared config sits inside
 * node_modules, where `src/**` matches nothing; Biome then falls back to checking the entire tree. So
 * ploaness dictates the block and the wiring gate enforces it byte for byte, which keeps ownership with
 * the harness even though the text has to sit at the project root.
 * @param sourceRoots the directories the project declared as holding first-party source.
 * @returns the exact block a conforming biome.json declares.
 */
export const requiredBiomeFiles = (
  sourceRoots: readonly string[],
): Readonly<Record<string, unknown>> => ({
  ignoreUnknown: false,
  includes: [
    ...sourceRoots.map((root: string): string => `${root}/**/*`),
    'package.json',
    'biome.json',
    'tsconfig.json',
    '*.config.ts',
    '*.config.mts',
    'vitest.setup.ts',
    '!src/payload-types.ts',
    '!src/app/(payload)/admin/importMap.js',
    '!**/.next',
    '!**/node_modules',
  ],
})

/**
 * The `include` and `exclude` a consumer's tsconfig.json must carry verbatim.
 *
 * The same constraint as {@link requiredBiomeFiles}, for the same reason: TypeScript resolves these globs
 * against the directory of the config that declares them. Left in the shared config they would walk the
 * ploaness package itself rather than the project, so they must sit at the project root while ploaness
 * keeps ownership of their contents.
 */
export const REQUIRED_TSCONFIG_PATHS: Readonly<Record<string, readonly string[]>> = {
  include: [
    'next-env.d.ts',
    '**/*.ts',
    '**/*.tsx',
    '**/*.mts',
    '.next/types/**/*.ts',
    '.next/dev/types/**/*.ts',
  ],
  exclude: ['node_modules'],
}

// tsconfig keys a project may legitimately set for itself. Everything else is a compiler strictness
// decision ploaness owns, so a local override is how a project would quietly weaken type checking.
const ALLOWED_TSCONFIG_COMPILER_OPTIONS: ReadonlySet<string> = new Set([
  'paths',
  'baseUrl',
  'plugins',
  'types',
  'rootDir',
  'outDir',
])

// Biome sections ploaness owns outright. A consumer redeclaring one of them replaces the harness rules
// for that section wholesale, which is a silent downgrade rather than an addition.
const OWNED_BIOME_SECTIONS: readonly string[] = ['linter', 'formatter', 'javascript', 'assist']

const asRecord = (raw: unknown): Record<string, unknown> =>
  typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}

const asStringRecord = (raw: unknown): Record<string, string> => {
  return Object.fromEntries(
    Object.entries(asRecord(raw)).filter(
      ([, value]: readonly [string, unknown]): boolean => typeof value === 'string',
    ),
  ) as Record<string, string>
}

const checkDependency = (packageJson: Record<string, unknown>): readonly WiringViolation[] =>
  Object.hasOwn(declaredDependencies(packageJson), 'ploaness')
    ? []
    : [
        {
          location: 'package.json',
          reason: 'ploaness must be a declared dependency of the project',
        },
      ]

const describeFound = (found: string | undefined): string =>
  found === undefined ? 'missing' : `"${found}"`

const checkExactEntries = (
  actual: Record<string, string>,
  required: Readonly<Record<string, string>>,
  locationPrefix: string,
): readonly WiringViolation[] =>
  Object.entries(required).flatMap(
    ([name, body]: readonly [string, string]): readonly WiringViolation[] => {
      const found: string | undefined = actual[name]
      if (found === body) {
        return []
      }
      return [
        {
          location: `${locationPrefix}.${name}`,
          reason: `is ${describeFound(found)} but ploaness requires "${body}"`,
        },
      ]
    },
  )

// A flat ESLint config is an array, so a consumer can append a block that switches rules back off after
// the harness config has been spread in. Requiring the file to be a bare re-export makes any addition
// surface as a wiring violation instead of a silent downgrade.
// Comments and blank lines are dropped first, so the pattern below describes only the two statements
// the file may contain. Expressing the preamble inside the pattern made it backtrack on a long file.
const COMMENT_OR_BLANK: RegExp = /^\s*(?:\/\/.*)?$/
// A config file the harness owns may contain nothing but an import of the shipped value and its
// default re-export. Anything more is a local block that overrides what ploaness supplies.
const reexportPattern = (specifier: string): RegExp => {
  const escaped: string = specifier.replace('/', String.raw`\/`)
  return new RegExp(
    String.raw`^import\s+(\w+)\s+from\s+['"]${escaped}['"];?\s*export\s+default\s+\1;?$`,
  )
}

const withoutPreamble = (config: string): string =>
  config
    .split('\n')
    .filter((line: string): boolean => !COMMENT_OR_BLANK.test(line))
    .join('\n')
    .trim()

// `vitest.config.mts` was seeded by `init` and then checked by nothing, while the tests gate runs the
// project's vitest with the project's config - so rewriting that file dropped the coverage thresholds,
// the include globs, and the environment without a single finding.
const checkReexport = (
  config: string | undefined,
  file: string,
  specifier: string,
): readonly WiringViolation[] => {
  if (config === undefined) {
    return [{ location: file, reason: `missing; must re-export ${specifier}` }]
  }
  return reexportPattern(specifier).test(withoutPreamble(config))
    ? []
    : [
        {
          location: file,
          reason:
            `must contain nothing but an import of ${specifier} and its default re-export; ` +
            'a local block would override the harness rules',
        },
      ]
}

const checkBiome = (
  config: string | undefined,
  requiredFiles: Readonly<Record<string, unknown>>,
): readonly WiringViolation[] => {
  if (config === undefined) {
    return [{ location: 'biome.json', reason: `missing; must extend ${REQUIRED_BIOME_EXTENDS}` }]
  }
  const parsed: Record<string, unknown> = asRecord(JSON.parse(config))
  const extendsValue: unknown = parsed['extends']
  const missingExtends: readonly WiringViolation[] =
    Array.isArray(extendsValue) && extendsValue.includes(REQUIRED_BIOME_EXTENDS)
      ? []
      : [
          {
            location: 'biome.json',
            reason: `must declare "extends": ["${REQUIRED_BIOME_EXTENDS}"]`,
          },
        ]
  const overriddenSections: readonly WiringViolation[] = OWNED_BIOME_SECTIONS.filter(
    (section: string): boolean => Object.hasOwn(parsed, section),
  ).map(
    (section: string): WiringViolation => ({
      location: `biome.json ${section}`,
      reason: 'ploaness owns this section; remove the local override',
    }),
  )
  const wrongFiles: readonly WiringViolation[] =
    JSON.stringify(parsed['files']) === JSON.stringify(requiredFiles)
      ? []
      : [
          {
            location: 'biome.json files',
            reason:
              'must declare the ploaness file-selection block verbatim; run `ploaness init` to write it',
          },
        ]
  return [...missingExtends, ...overriddenSections, ...wrongFiles]
}

const checkTsconfig = (config: string | undefined): readonly WiringViolation[] => {
  if (config === undefined) {
    return [
      { location: 'tsconfig.json', reason: `missing; must extend ${REQUIRED_TSCONFIG_EXTENDS}` },
    ]
  }
  const parsed: Record<string, unknown> = asRecord(JSON.parse(config))
  const wrongExtends: readonly WiringViolation[] =
    parsed['extends'] === REQUIRED_TSCONFIG_EXTENDS
      ? []
      : [
          {
            location: 'tsconfig.json',
            reason: `must declare "extends": "${REQUIRED_TSCONFIG_EXTENDS}"`,
          },
        ]
  const overriddenOptions: readonly WiringViolation[] = Object.keys(
    asRecord(parsed['compilerOptions']),
  )
    .filter((key: string): boolean => !ALLOWED_TSCONFIG_COMPILER_OPTIONS.has(key))
    .map(
      (key: string): WiringViolation => ({
        location: `tsconfig.json compilerOptions.${key}`,
        reason: 'ploaness owns this compiler option; remove the local override',
      }),
    )
  const wrongPaths: readonly WiringViolation[] = Object.entries(REQUIRED_TSCONFIG_PATHS)
    .filter(
      ([key, value]: readonly [string, unknown]): boolean =>
        JSON.stringify(parsed[key]) !== JSON.stringify(value),
    )
    .map(
      ([key]: readonly [string, unknown]): WiringViolation => ({
        location: `tsconfig.json ${key}`,
        reason: 'must declare the ploaness value verbatim; run `ploaness init` to write it',
      }),
    )
  return [...wrongExtends, ...overriddenOptions, ...wrongPaths]
}

// These libraries cannot move into the harness. Under the strict pnpm layout a consumer spec could not
// resolve `import { describe } from "vitest"` if vitest were only a dependency of ploaness, so the
// project must declare them itself and ploaness pins the version instead of owning the package.
// A pinned version is only a pin while nothing else can change it. An `overrides` entry installs a
// different version and leaves the declaration in package.json untouched, so the version check passes
// while the code runs against something ploaness never saw. The ploaness packages themselves are not
// pinned this way, so a pre-publication consumer may still point them at a local tarball.

// The sanctioned route for an advisory a project cannot reach is `ploaness.vulnerabilityAllowlist`,
// which records a reason and a date and fails once the entry stops suppressing anything.
const checkSilencedAdvisories = (packageJson: unknown): readonly WiringViolation[] =>
  findSilencedAdvisories(packageJson).map(
    (key: string): WiringViolation => ({
      location: `package.json pnpm.auditConfig.${key}`,
      reason:
        'silences the vulnerability gate; record the advisory in ' +
        'ploaness.vulnerabilityAllowlist instead, with a reason and a date',
    }),
  )

/**
 * Return every way the consuming project has weakened or dropped its ploaness wiring. An empty array
 * means the harness is installed exactly as ploaness dictates and cannot have been quietly disarmed.
 * @param inputs the consumer files and expectations to judge.
 * @returns one violation per defect, in a stable order.
 */
export const findWiringViolations = (inputs: WiringInputs): readonly WiringViolation[] => {
  const packageJson: Record<string, unknown> = asRecord(inputs.packageJson)
  return [
    ...checkDependency(packageJson),
    ...checkExactEntries(
      asStringRecord(packageJson['scripts']),
      REQUIRED_SCRIPTS,
      'package.json scripts',
    ),
    ...findVersionViolations(packageJson, {
      expected: inputs.expectedTestLibraries,
      required: inputs.requiredTestLibraries,
      payloadVersion: inputs.payloadVersion,
      requiredPackageManager: inputs.requiredPackageManager,
      requiredEngines: inputs.requiredEngines,
      workspaceFile: inputs.workspaceFile,
    }),
    ...checkSilencedAdvisories(inputs.packageJson),
    ...findConvenienceExclusions(inputs.declaredExclusions).map(
      (reason: string): WiringViolation => ({ location: 'package.json ploaness', reason }),
    ),
    ...checkReexport(inputs.eslintConfig, 'eslint.config.mjs', 'ploaness/eslint'),
    ...checkReexport(inputs.vitestConfig, 'vitest.config.mts', 'ploaness/vitest'),
    ...checkReexport(inputs.playwrightConfig, 'playwright.config.ts', 'ploaness/playwright'),
    ...checkBiome(inputs.biomeConfig, inputs.requiredBiomeFiles),
    ...checkTsconfig(inputs.tsconfig),
  ]
}
