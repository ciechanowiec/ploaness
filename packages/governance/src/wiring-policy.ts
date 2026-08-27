import { GENERATED_ARTEFACTS } from './generated-denial.js'
import { findSilencedAdvisories } from './install-policy.js'
import {
  asRecord,
  asStringRecord,
  declaredDependencies,
  isArray,
  type ParsedJson,
  parseJsonc,
} from './json-shapes.js'
import { type DeclaredExclusion, findConvenienceExclusions } from './settings.js'
import { escapeForRegex } from './text-escapes.js'
import {
  describeFound,
  findPackageVersionViolations,
  findRepositoryVersionViolations,
  type PackageVersionInputs,
  type RepositoryVersionInputs,
} from './version-policy.js'
import type { WiringViolation } from './wiring-violation.js'
import type { MemberKind } from './workspace-policy.js'
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
  kind: MemberKind = 'payload',
  generatedArtefacts: readonly string[] = GENERATED_ARTEFACTS,
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
    // Derived from the artefact list rather than written out. The two lists had to name the same paths
    // and did not: `src/payload-generated-schema.ts` was denied to an agent and still handed to the
    // formatter, so a generator and a formatter took turns rewriting one file.
    // Only a Payload member has these. Negating them elsewhere would name paths that cannot exist,
    // which `config-refs` reports as a carve-out reaching nothing.
    ...(kind === 'payload'
      ? generatedArtefacts.map((artefact: string): string => `!${artefact}`)
      : []),
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

/**
 * The `include` and `exclude` a member with no Next application must carry.
 *
 * The Payload globs name `next-env.d.ts` and two `.next` type directories. In a package that never runs
 * Next those are carve-outs reaching nothing, which is itself a finding - so the kind that cannot have
 * them does not claim them.
 */
export const LIBRARY_TSCONFIG_PATHS: Readonly<Record<string, readonly string[]>> = {
  include: ['**/*.ts', '**/*.tsx', '**/*.mts'],
  exclude: ['node_modules', 'dist'],
}

/**
 * The `include` and `exclude` one member must carry, given the members nested inside it.
 *
 * The required `include` is a recursive TypeScript glob, which at a WORKSPACE ROOT sweeps every
 * member's sources into the root's own project - under the ROOT's `paths`, where a member's `@/*`
 * resolves to the wrong directory. eoc's root read the CMS scripts that way and failed `types` on
 * imports that resolve perfectly well inside the CMS. Excluding them is not a relaxation: a member's
 * analysis stops at its own boundary, which is the rule `knipConfig` already applies for the same
 * reason, and each nested member is compiled by its own run.
 *
 * Derived rather than declared, so a member cannot exclude a sibling it does not contain and cannot
 * forget one it does - and `ploaness init` writes exactly what the rule then asks for.
 * @param base the paths for this member's kind.
 * @param nestedMembers the repo-relative paths of the governed members inside this one.
 * @returns the same paths, with every nested member excluded.
 */
export const tsconfigPathsFor = (
  base: Readonly<Record<string, readonly string[]>>,
  nestedMembers: readonly string[],
): Readonly<Record<string, readonly string[]>> =>
  nestedMembers.length === 0
    ? base
    : { ...base, exclude: [...(base['exclude'] ?? []), ...nestedMembers] }

/**
 * Everything a member of one kind must point at.
 *
 * Declared once and consumed by both the rule and `ploaness init`, for the reason the whole module
 * exists: two literals that must stay equal will not, and that has already shipped a defect where the
 * scaffolder wrote a project the gate then failed.
 */
export interface MemberWiringTargets {
  readonly biomeExtends: string
  readonly tsconfigExtends: string
  readonly tsconfigPaths: Readonly<Record<string, readonly string[]>>
  readonly eslintSpecifier: string
  readonly vitestSpecifier: string
  /** undefined when this kind has no application to drive, and so is not asked for a browser config. */
  readonly playwrightSpecifier: string | undefined
}

const LIBRARY_TARGETS: MemberWiringTargets = {
  biomeExtends: 'ploaness/biome-core',
  tsconfigExtends: 'ploaness/tsconfig-core.json',
  tsconfigPaths: LIBRARY_TSCONFIG_PATHS,
  eslintSpecifier: 'ploaness/eslint-library',
  vitestSpecifier: 'ploaness/vitest-library',
  playwrightSpecifier: undefined,
}

const APPLICATION_TARGETS: MemberWiringTargets = {
  biomeExtends: REQUIRED_BIOME_EXTENDS,
  tsconfigExtends: REQUIRED_TSCONFIG_EXTENDS,
  tsconfigPaths: REQUIRED_TSCONFIG_PATHS,
  eslintSpecifier: 'ploaness/eslint',
  vitestSpecifier: 'ploaness/vitest',
  playwrightSpecifier: 'ploaness/playwright',
}

/**
 * The wiring one kind of member must declare.
 *
 * A Next application receives the same configurations as a Payload one: it renders React, it builds
 * through Next, and it serves pages a browser sweep can drive. What separates the two is the generated
 * files only Payload has, which {@link requiredBiomeFiles} handles by kind rather than by a second
 * configuration.
 * @param kind the member's derived kind.
 * @returns the specifiers and globs that kind is held to.
 */
export const wiringTargetsFor = (kind: MemberKind): MemberWiringTargets =>
  kind === 'library' ? LIBRARY_TARGETS : APPLICATION_TARGETS

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
// `plugins` is here rather than as a forbidden PATH. Forbidding a top-level directory called `plugins`
// caught the thing it meant to - a project's own GritQL rules shadowing the shipped ones - and also any
// unrelated directory that happened to share the name. What actually shadows is the key that loads
// them, and a project declaring it is replacing ploaness's rules for that section like any other.
const OWNED_BIOME_SECTIONS: readonly string[] = [
  'linter',
  'formatter',
  'javascript',
  'assist',
  'plugins',
]

const checkDependency = (packageJson: Record<string, unknown>): readonly WiringViolation[] =>
  Object.hasOwn(declaredDependencies(packageJson), 'ploaness')
    ? []
    : [
        {
          location: 'package.json',
          reason: 'ploaness must be a declared dependency of the project',
        },
      ]

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
//
// Comments and blank lines are dropped first, so the pattern below describes only the two statements
// the file may contain. Expressing the preamble inside the pattern made it backtrack on a long file.
// A block comment counts as a comment: the filter read `//` alone, so a file opening with the `/* */`
// header a generator writes failed as though it carried a local override.
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g
const COMMENT_OR_BLANK: RegExp = /^\s*(?:\/\/.*)?$/
// A config file the harness owns may contain nothing but an import of the shipped value and its
// default re-export. Anything more is a local block that overrides what ploaness supplies.
const reexportPattern = (specifier: string): RegExp =>
  new RegExp(
    String.raw`^import\s+(\w+)\s+from\s+['"]${escapeForRegex(specifier)}['"];?\s*export\s+default\s+\1;?$`,
  )

// Line endings are normalised before anything reads a line. `.` does not cross a `\r`, so on a CRLF
// checkout every comment line survived the filter and every re-export check failed on a file that was
// correct - a whole platform's worth of false findings from one character nobody prints.
const withoutPreamble = (config: string): string =>
  config
    .replaceAll('\r\n', '\n')
    .replaceAll(BLOCK_COMMENT, '')
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

// What a consumer has to change, named entry by entry.
//
// The finding used to say the block "must match" and stop there. Both blocks are right here, so the
// reader was being asked to diff two fifteen-entry lists by eye to find the one carve-out a newer
// ploaness added - and the advice it offered instead, `ploaness init`, cannot repair a file that
// already exists, which is the only state this finding is reachable in.
const listOf = (value: unknown): readonly string[] =>
  isArray(value) ? value.map((entry: unknown): string => JSON.stringify(entry)) : []

const describeBiomeDrift = (
  declared: unknown,
  required: Readonly<Record<string, unknown>>,
): string => {
  const declaredIncludes: readonly string[] = listOf(asRecord(declared)['includes'])
  const requiredIncludes: readonly string[] = listOf(required['includes'])
  const missing: readonly string[] = requiredIncludes.filter(
    (entry: string): boolean => !declaredIncludes.includes(entry),
  )
  const unexpected: readonly string[] = declaredIncludes.filter(
    (entry: string): boolean => !requiredIncludes.includes(entry),
  )
  const parts: readonly string[] = [
    ...(missing.length > 0 ? [`add ${missing.join(', ')}`] : []),
    ...(unexpected.length > 0 ? [`remove ${unexpected.join(', ')}`] : []),
  ]
  // Same entries, different block: the order, or `ignoreUnknown`. Naming no entry would leave the
  // reader exactly where the old wording did, so say which of the two it is.
  return parts.length === 0
    ? 'declares the ploaness includes entries in another order, or another "ignoreUnknown"; the ' +
        'block is required verbatim'
    : `${parts.join(' and ')} in the includes block, which ploaness requires verbatim`
}

// A nested Biome configuration must declare itself not to be a root, or Biome refuses the whole tree
// with "found a nested root configuration". The member cannot inherit the answer: `root` describes the
// file that declares it, so the shipped config saying `root: false` says nothing about a consumer's.
const checkBiomeRoot = (
  parsed: Record<string, unknown>,
  isNestedMember: boolean,
): readonly WiringViolation[] =>
  !isNestedMember || parsed['root'] === false
    ? []
    : [
        {
          location: 'biome.json root',
          reason:
            'must declare "root": false; Biome refuses a second root configuration in one tree, ' +
            'and rejects every file in the repository rather than only this package',
        },
      ]

const checkBiome = (
  config: string | undefined,
  requiredFiles: Readonly<Record<string, unknown>>,
  biomeExtends: string,
  isNestedMember: boolean = false,
): readonly WiringViolation[] => {
  if (config === undefined) {
    return [{ location: 'biome.json', reason: `missing; must extend ${biomeExtends}` }]
  }
  const read: ParsedJson = parseJsonc(config)
  if (read.problem !== undefined) {
    return [{ location: 'biome.json', reason: `is not valid JSON: ${read.problem}` }]
  }
  const parsed: Record<string, unknown> = asRecord(read.value)
  const extendsValue: unknown = parsed['extends']
  const missingExtends: readonly WiringViolation[] =
    isArray(extendsValue) && extendsValue.includes(biomeExtends)
      ? []
      : [
          {
            location: 'biome.json',
            reason: `must declare "extends": ["${biomeExtends}"]`,
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
            reason: describeBiomeDrift(parsed['files'], requiredFiles),
          },
        ]
  return [
    ...missingExtends,
    ...checkBiomeRoot(parsed, isNestedMember),
    ...overriddenSections,
    ...wrongFiles,
  ]
}

const checkTsconfig = (
  config: string | undefined,
  targets: MemberWiringTargets,
  nestedMembers: readonly string[],
): readonly WiringViolation[] => {
  if (config === undefined) {
    return [
      { location: 'tsconfig.json', reason: `missing; must extend ${targets.tsconfigExtends}` },
    ]
  }
  const read: ParsedJson = parseJsonc(config)
  if (read.problem !== undefined) {
    return [{ location: 'tsconfig.json', reason: `is not valid JSON: ${read.problem}` }]
  }
  const parsed: Record<string, unknown> = asRecord(read.value)
  const wrongExtends: readonly WiringViolation[] =
    parsed['extends'] === targets.tsconfigExtends
      ? []
      : [
          {
            location: 'tsconfig.json',
            reason: `must declare "extends": "${targets.tsconfigExtends}"`,
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
  const wrongPaths: readonly WiringViolation[] = Object.entries(
    tsconfigPathsFor(targets.tsconfigPaths, nestedMembers),
  )
    .filter(
      ([key, value]: readonly [string, unknown]): boolean =>
        JSON.stringify(parsed[key]) !== JSON.stringify(value),
    )
    .map(
      ([key, value]: readonly [string, unknown]): WiringViolation => ({
        location: `tsconfig.json ${key}`,
        // Printed rather than described, for the reason the biome block above is: this is reachable
        // only once tsconfig.json exists, so the reader is editing a value and needs to see it.
        reason: `must declare the ploaness value verbatim: ${JSON.stringify(value)}`,
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

/** The repository-level files and declarations the wiring gate reads once, at the git root. */
export interface RepositoryWiringInputs {
  readonly packageJson: unknown
  readonly workspaceFile: string
  readonly declaredExclusions: readonly DeclaredExclusion[]
  readonly expectedTestLibraries: Readonly<Record<string, string>>
  readonly requiredPackageManager: string | undefined
  readonly requiredEngines: Readonly<Record<string, string>>
  /** Every dependency any member declares, so a root override can be judged against all of them. */
  readonly declaredAcrossMembers: Readonly<Record<string, string>>
  /** Findings the CLI supplies from rules that need the member list rather than one manifest. */
  readonly repositoryFindings: readonly WiringViolation[]
}

/** The files and declarations the wiring gate reads inside one member. */
export interface PackageWiringInputs {
  readonly packageJson: unknown
  readonly kind: MemberKind
  /**
   * Whether this member sits below the repository root. Biome refuses a second ROOT configuration in
   * one tree, so a nested member has to say it is not one - and the shipped config cannot say it for
   * the member, because `root` describes the file that declares it rather than the file it extends.
   */
  readonly isNestedMember: boolean
  /**
   * The governed members nested INSIDE this one, repo-relative.
   *
   * Empty for every member of a single-package project and for a leaf member of a workspace; non-empty
   * only for a member that contains others, which in practice is the workspace root.
   */
  readonly nestedMembers: readonly string[]
  /** The `files` block this member's biome.json must carry, from {@link requiredBiomeFiles}. */
  readonly requiredBiomeFiles: Readonly<Record<string, unknown>>
  readonly eslintConfig: string | undefined
  readonly vitestConfig: string | undefined
  readonly playwrightConfig: string | undefined
  readonly declaredExclusions: readonly DeclaredExclusion[]
  readonly biomeConfig: string | undefined
  readonly tsconfig: string | undefined
  readonly expectedTestLibraries: Readonly<Record<string, string>>
  readonly requiredTestLibraries: ReadonlySet<string>
  readonly payloadVersion: string | undefined
}

/**
 * Return every way the repository has weakened or dropped its ploaness wiring.
 *
 * These are the declarations that exist once per repository however many packages it holds: the package
 * manager that resolves the whole tree, the engines an installer reads, the scripts a run is invoked
 * through, and the overrides pnpm honours only at the root.
 * @param inputs the repository-level files to judge.
 * @returns one violation per defect, in a stable order.
 */
export const findRepositoryWiringViolations = (
  inputs: RepositoryWiringInputs,
): readonly WiringViolation[] => {
  const packageJson: Record<string, unknown> = asRecord(inputs.packageJson)
  return [
    ...checkDependency(packageJson),
    ...checkExactEntries(
      asStringRecord(packageJson['scripts']),
      REQUIRED_SCRIPTS,
      'package.json scripts',
    ),
    ...findRepositoryVersionViolations(packageJson, {
      expected: inputs.expectedTestLibraries,
      requiredPackageManager: inputs.requiredPackageManager,
      requiredEngines: inputs.requiredEngines,
      workspaceFile: inputs.workspaceFile,
      declaredAcrossMembers: inputs.declaredAcrossMembers,
    } satisfies RepositoryVersionInputs),
    ...checkSilencedAdvisories(inputs.packageJson),
    ...findConvenienceExclusions(inputs.declaredExclusions).map(
      (reason: string): WiringViolation => ({ location: 'package.json ploaness', reason }),
    ),
    ...inputs.repositoryFindings,
  ]
}

/**
 * Return every way one member has weakened or dropped its ploaness wiring.
 *
 * A library member is not asked for a Playwright configuration: it has no application to drive, and
 * requiring the file would make a package fail for not having a browser it was never going to open.
 * @param inputs the member's files to judge.
 * @returns one violation per defect, in a stable order.
 */
export const findPackageWiringViolations = (
  inputs: PackageWiringInputs,
): readonly WiringViolation[] => {
  const packageJson: Record<string, unknown> = asRecord(inputs.packageJson)
  const targets: MemberWiringTargets = wiringTargetsFor(inputs.kind)
  return [
    ...checkDependency(packageJson),
    ...findPackageVersionViolations(packageJson, {
      expected: inputs.expectedTestLibraries,
      required: inputs.requiredTestLibraries,
      payloadVersion: inputs.payloadVersion,
    } satisfies PackageVersionInputs),
    ...findConvenienceExclusions(inputs.declaredExclusions).map(
      (reason: string): WiringViolation => ({ location: 'package.json ploaness', reason }),
    ),
    ...checkReexport(inputs.eslintConfig, 'eslint.config.mjs', targets.eslintSpecifier),
    ...checkReexport(inputs.vitestConfig, 'vitest.config.mts', targets.vitestSpecifier),
    ...(targets.playwrightSpecifier === undefined
      ? []
      : checkReexport(
          inputs.playwrightConfig,
          'playwright.config.ts',
          targets.playwrightSpecifier,
        )),
    ...checkBiome(
      inputs.biomeConfig,
      inputs.requiredBiomeFiles,
      targets.biomeExtends,
      inputs.isNestedMember,
    ),
    ...checkTsconfig(inputs.tsconfig, targets, inputs.nestedMembers),
  ]
}

/**
 * The whole wiring contract for a repository holding exactly one package.
 *
 * Not a shim over the split: a single-package repository IS both scopes over one manifest, so composing
 * the halves is what that case means. It is kept as an entry point because the behaviour it describes is
 * pinned by a large spec written before the scopes existed - and that spec passing unchanged is the
 * evidence the split dropped nothing.
 * @param inputs the consumer files and expectations to judge.
 * @returns one violation per defect, in a stable order.
 */
export const findWiringViolations = (inputs: WiringInputs): readonly WiringViolation[] => [
  ...findRepositoryWiringViolations({
    packageJson: inputs.packageJson,
    workspaceFile: inputs.workspaceFile,
    declaredExclusions: inputs.declaredExclusions,
    expectedTestLibraries: inputs.expectedTestLibraries,
    requiredPackageManager: inputs.requiredPackageManager,
    requiredEngines: inputs.requiredEngines,
    declaredAcrossMembers: declaredDependencies(inputs.packageJson),
    repositoryFindings: [],
  }),
  ...findPackageWiringViolations({
    packageJson: inputs.packageJson,
    kind: 'payload',
    isNestedMember: false,
    // A single-package project has no members inside it, which is what makes this composition equal to
    // what shipped before the workspace split.
    nestedMembers: [],
    requiredBiomeFiles: inputs.requiredBiomeFiles,
    eslintConfig: inputs.eslintConfig,
    vitestConfig: inputs.vitestConfig,
    playwrightConfig: inputs.playwrightConfig,
    declaredExclusions: inputs.declaredExclusions,
    biomeConfig: inputs.biomeConfig,
    tsconfig: inputs.tsconfig,
    expectedTestLibraries: inputs.expectedTestLibraries,
    requiredTestLibraries: inputs.requiredTestLibraries,
    payloadVersion: inputs.payloadVersion,
  }),
]
