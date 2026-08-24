import { findOverrides, findSilencedAdvisories, type OverrideEntry } from './install-policy.js'
import { type DeclaredExclusion, findConvenienceExclusions } from './settings.js'
// Anti-bypass policy: the module that exists because npm has no lifecycle.
//
// A build tool that bound its checks to fixed phases would make this unnecessary: the checks would run
// because the build ran, and the harness would only have to stop a project redeclaring them away. npm
// binds nothing. A `package.json` script is a consumer-owned string, so a project (or an agent working in
// it) can rewrite `verify` to `echo ok`, append a rule-disabling block to the flat ESLint config, or drop
// the harness out of CI, and nothing downstream would notice.
//
// So ploaness makes its own installation a governed domain. This module holds the pure rules; the gate
// that reads the files lives in the CLI. It cannot make bypass impossible, since a project can always
// uninstall the dependency, but it makes bypass loud and deliberate rather than silent, which is the
// property a fixed build lifecycle would have supplied for free.

/** A defect in how the consuming project has wired ploaness into itself. */
export interface WiringViolation {
  readonly location: string
  readonly reason: string
}

/** One CI workflow definition found in the consumer repository. */
export interface WorkflowFile {
  readonly name: string
  readonly content: string
}

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
  /** Whether a path exists in the working tree, injected so this module stays free of I/O. */
  readonly isExistingPath: (path: string) => boolean
  readonly biomeConfig: string | undefined
  readonly tsconfig: string | undefined
  readonly workflows: readonly WorkflowFile[]
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

const LAST_ENTRY: number = -1

/** One place a workflow invokes verification, with the step that carries it. */
interface WorkflowInvocation {
  readonly workflow: WorkflowFile
  readonly line: string
  readonly step: readonly string[]
}

/** Extended verification must run in CI, invoked either directly or through the owned script. */
export const CI_INVOCATIONS: readonly string[] = ['ploaness verify --extended', 'run verify:full']

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

const declaredDependencies = (packageJson: Record<string, unknown>): Record<string, string> => ({
  ...asStringRecord(packageJson['dependencies']),
  ...asStringRecord(packageJson['devDependencies']),
})

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

/** The flag that turns verification into a report. A run in that mode is not a pass. */
export const REPORT_ONLY_FLAG: string = '--enforce=false'

/** The step setting that lets a workflow continue after the verification step has failed. */
const CONTINUE_ON_ERROR: string = 'continue-on-error'

const isComment = (line: string): boolean => line.trimStart().startsWith('#')

const isStepStart = (line: string): boolean => /^\s*-\s/.test(line)

// The line indexes that actually invoke verification. A mention inside a comment is not an invocation,
// which is why the whole file is no longer searched as one string.
const invokingLines = (lines: readonly string[]): readonly number[] =>
  lines.flatMap((line: string, index: number): readonly number[] =>
    !isComment(line) &&
    CI_INVOCATIONS.some((invocation: string): boolean => line.includes(invocation))
      ? [index]
      : [],
  )

// The step a line belongs to: from the nearest list item at or above it, to the next one.
const stepAround = (lines: readonly string[], index: number): readonly string[] => {
  const startCandidates: readonly number[] = lines
    .slice(0, index + 1)
    .flatMap((line: string, at: number): readonly number[] => (isStepStart(line) ? [at] : []))
  const start: number = startCandidates.at(LAST_ENTRY) ?? 0
  const after: number = lines
    .slice(start + 1)
    .findIndex((line: string): boolean => isStepStart(line))
  return after === -1 ? lines.slice(start) : lines.slice(start, start + 1 + after)
}

// A workflow that runs verification but neuters it is worse than one that never ran it: the project is
// green forever and the harness reports that its wiring is intact. Both escapes are checked on the step
// that carries the invocation rather than on the file, so an unrelated step may still tolerate failure.
const checkWorkflows = (workflows: readonly WorkflowFile[]): readonly WiringViolation[] => {
  const invoking: readonly WorkflowInvocation[] = workflows.flatMap(
    (workflow: WorkflowFile): readonly WorkflowInvocation[] => {
      const lines: readonly string[] = workflow.content.split('\n')
      return invokingLines(lines).map(
        (index: number): WorkflowInvocation => ({
          workflow,
          line: lines[index] ?? '',
          step: stepAround(lines, index),
        }),
      )
    },
  )
  if (invoking.length === 0) {
    return [
      {
        location: '.github/workflows',
        reason:
          'no workflow runs extended verification; ploaness enforces no local git hooks, so CI is the only backstop',
      },
    ]
  }
  return invoking.flatMap((found: WorkflowInvocation): readonly WiringViolation[] => {
    const reportOnly: readonly WiringViolation[] = found.line.includes(REPORT_ONLY_FLAG)
      ? [
          {
            location: `.github/workflows/${found.workflow.name}`,
            reason:
              `runs verification with ${REPORT_ONLY_FLAG}, which prints findings and exits 0; ` +
              'a run in that mode is not a pass',
          },
        ]
      : []
    const tolerated: readonly WiringViolation[] = found.step.some((line: string): boolean =>
      line.includes(CONTINUE_ON_ERROR),
    )
      ? [
          {
            location: `.github/workflows/${found.workflow.name}`,
            reason:
              `declares ${CONTINUE_ON_ERROR} on the step that runs verification, ` +
              'so a failing run cannot fail the workflow',
          },
        ]
      : []
    return [...reportOnly, ...tolerated]
  })
}

// These libraries cannot move into the harness. Under the strict pnpm layout a consumer spec could not
// resolve `import { describe } from "vitest"` if vitest were only a dependency of ploaness, so the
// project must declare them itself and ploaness pins the version instead of owning the package.
// A pinned version is only a pin while nothing else can change it. An `overrides` entry installs a
// different version and leaves the declaration in package.json untouched, so the version check passes
// while the code runs against something ploaness never saw. The ploaness packages themselves are not
// pinned this way, so a pre-publication consumer may still point them at a local tarball.
const overrideViolation = (
  entry: OverrideEntry,
  expected: Readonly<Record<string, string>>,
  declared: Record<string, string>,
): readonly WiringViolation[] => {
  const location: string = `pnpm-workspace.yaml ${entry.key}.${entry.packageName}`
  if (Object.hasOwn(expected, entry.packageName)) {
    return [
      {
        location,
        reason:
          'redefines a version ploaness pins; remove it, because the pin decides what the ' +
          'gates run against',
      },
    ]
  }
  const own: string | undefined = declared[entry.packageName]
  return own === undefined
    ? []
    : [
        {
          location,
          reason:
            `overrides a package the project declares at "${own}"; change the declaration ` +
            'instead, or the installed version is not the declared one',
        },
      ]
}

// A project may override what it does not declare, and may not override what it does. The permitted
// case is a transitive package carrying an advisory with no upgrade path above it, which the project
// can reach no other way and which the standard says to resolve by upgrading rather than excusing. The
// forbidden case is a package whose version the project already wrote down: two declarations of one
// version will not stay equal, and the one that loses is the one every reader believes. The ploaness
// packages are neither, so a pre-publication consumer may still point them at a local tarball.
const checkPinnedOverrides = (
  workspaceFile: string,
  expected: Readonly<Record<string, string>>,
  packageJson: Record<string, unknown>,
): readonly WiringViolation[] => {
  const declared: Record<string, string> = declaredDependencies(packageJson)
  return findOverrides(workspaceFile).flatMap((entry: OverrideEntry): readonly WiringViolation[] =>
    overrideViolation(entry, expected, declared),
  )
}

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

// Corepack reads `packageManager` and runs exactly that version, so it decides how every other pinned
// version is resolved. A project on a different pnpm can produce a different tree from the same
// lockfile, which makes every pin above it a statement about a graph nobody built.
const checkPackageManager = (
  packageJson: Record<string, unknown>,
  required: string | undefined,
): readonly WiringViolation[] => {
  if (required === undefined) {
    return []
  }
  const declared: unknown = packageJson['packageManager']
  return declared === required
    ? []
    : [
        {
          location: 'package.json packageManager',
          reason: `is ${describeFound(asOptionalText(declared))} but ploaness requires "${required}"`,
        },
      ]
}

const asOptionalText = (raw: unknown): string | undefined =>
  typeof raw === 'string' ? raw : undefined

// `preflight` checks the Node that is actually running, which is the version a gate is executed by.
// The `engines` block is a different statement: it is what the project tells an installer, a CI image
// and a reader to use. Leaving it unchecked let a project declare a runtime ploaness refuses.
const checkEngines = (
  packageJson: Record<string, unknown>,
  required: Readonly<Record<string, string>>,
): readonly WiringViolation[] => {
  const declared: Record<string, string> = asStringRecord(packageJson['engines'])
  return Object.entries(required).flatMap(
    ([name, range]: readonly [string, string]): readonly WiringViolation[] =>
      declared[name] === range
        ? []
        : [
            {
              location: `package.json engines.${name}`,
              reason: `is ${describeFound(declared[name])} but ploaness requires "${range}"`,
            },
          ],
  )
}

// A specifier that is not a registry version at all: a local tarball, a workspace link, a git or npm
// alias. None of them is a range, and a pre-publication consumer resolves the ploaness packages this
// way, so the range ban must read past them rather than through them.
const NON_REGISTRY: RegExp = /^(?:file|link|workspace|catalog|git\+[a-z]+|git|github|npm|https?):/

// Anything that resolves to "whichever version is newest at install time". The standard pins the
// toolchain so an upstream release cannot change a verdict while the project stays unchanged, and a
// range on an application dependency is the same hole one layer down: the build, the suite and the
// end-to-end run all execute against something nobody wrote down. `*` and an empty specifier are the
// widest ranges of all rather than exceptions to the rule.
const RANGE_OPERATOR: RegExp = /^\s*(?:[\^~><=*]|$)/
const RANGE_UNION: RegExp = /\|\||\s-\s|\sx$|\.x/

const isExactVersion = (specifier: string): boolean => {
  if (NON_REGISTRY.test(specifier)) {
    return true
  }
  return !(RANGE_OPERATOR.test(specifier) || RANGE_UNION.test(specifier))
}

const checkExactVersions = (packageJson: Record<string, unknown>): readonly WiringViolation[] =>
  Object.entries(declaredDependencies(packageJson))
    .filter(([, specifier]: readonly [string, string]): boolean => !isExactVersion(specifier))
    .map(
      ([name, specifier]: readonly [string, string]): WiringViolation => ({
        location: `package.json ${name}`,
        reason:
          `is "${specifier}", which is a range; declare one exact version, because a range ` +
          'lets an upstream release change what the gates run against',
      }),
    )

// Payload refuses to boot, or fails in ways that read as application defects, when its own packages
// disagree about their version. The rule is derived from the pinned `payload` rather than written as a
// list, so a project adding `@payloadcms/plugin-form-builder` is covered by the rule that already
// exists instead of by an entry somebody has to remember.
const PAYLOAD_SCOPE: string = '@payloadcms/'

const checkPayloadFamily = (
  packageJson: Record<string, unknown>,
  payloadVersion: string | undefined,
): readonly WiringViolation[] => {
  if (payloadVersion === undefined) {
    return []
  }
  return Object.entries(declaredDependencies(packageJson))
    .filter(
      ([name, version]: readonly [string, string]): boolean =>
        name.startsWith(PAYLOAD_SCOPE) && version !== payloadVersion,
    )
    .map(
      ([name, version]: readonly [string, string]): WiringViolation => ({
        location: `package.json ${name}`,
        reason:
          `is "${version}" but payload is pinned at "${payloadVersion}"; ` +
          'Payload fails at runtime when its own packages disagree',
      }),
    )
}

// Two obligations, not one. A project must DECLARE the few packages every project uses, because under
// the strict pnpm layout its own specs could not resolve them otherwise. Every other pinned package
// must MATCH when the project declares it, but is not forced on a project that has no use for it -
// requiring a declaration there would manufacture a dependency the dead-code gate then reports as
// unused. Either way no pinned version can float, which is the point.
const checkTestLibraries = (
  packageJson: Record<string, unknown>,
  expected: Readonly<Record<string, string>>,
  required: ReadonlySet<string>,
): readonly WiringViolation[] => {
  const declared: Record<string, string> = declaredDependencies(packageJson)
  return Object.entries(expected).flatMap(
    ([name, version]: readonly [string, string]): readonly WiringViolation[] => {
      const found: string | undefined = declared[name]
      if (found === undefined) {
        return required.has(name)
          ? [
              {
                location: `package.json devDependencies.${name}`,
                reason: `missing; specs import it directly, so the project must declare it at ${version}`,
              },
            ]
          : []
      }
      return found === version
        ? []
        : [
            {
              location: `package.json devDependencies.${name}`,
              reason:
                `is "${found}" but ploaness pins it at "${version}"; ` +
                'a range lets an upstream release change a verdict',
            },
          ]
    },
  )
}

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
    ...checkTestLibraries(packageJson, inputs.expectedTestLibraries, inputs.requiredTestLibraries),
    ...checkExactVersions(packageJson),
    ...checkPayloadFamily(packageJson, inputs.payloadVersion),
    ...checkPackageManager(packageJson, inputs.requiredPackageManager),
    ...checkEngines(packageJson, inputs.requiredEngines),
    ...checkPinnedOverrides(inputs.workspaceFile, inputs.expectedTestLibraries, packageJson),
    ...checkSilencedAdvisories(inputs.packageJson),
    ...findConvenienceExclusions(inputs.declaredExclusions, inputs.isExistingPath).map(
      (reason: string): WiringViolation => ({ location: 'package.json ploaness', reason }),
    ),
    ...checkReexport(inputs.eslintConfig, 'eslint.config.mjs', 'ploaness/eslint'),
    ...checkReexport(inputs.vitestConfig, 'vitest.config.mts', 'ploaness/vitest'),
    ...checkReexport(inputs.playwrightConfig, 'playwright.config.ts', 'ploaness/playwright'),
    ...checkBiome(inputs.biomeConfig, inputs.requiredBiomeFiles),
    ...checkTsconfig(inputs.tsconfig),
    ...checkWorkflows(inputs.workflows),
  ]
}
