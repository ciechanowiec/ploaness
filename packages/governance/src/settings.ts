// Consumer-declared parameters. A project
// declares them under a `ploaness` key in its package.json. Every field is optional and every default is
// deliberately strict, so a project that declares nothing still receives the full contract.
//
// The set is intentionally small. ploaness owns the rules; a project may declare only the facts ploaness
// cannot know for it: where its sources live, which generated file a rule must skip, how large its
// bundle may grow. There is no field that turns a gate off, because "do not disable the failing check"
// is the contract rather than a preference.

import { BUNDLE_BUDGET_BYTES } from './bundle-budget.js'
import { matchesGlob, matchesRole } from './file-roles.js'
// Only string-valued entries survive `asStringRecord`: a non-string would reach `spawn` as a
// malformed environment.
import { asRecord, asStringRecord, asText, isArray, isRecord } from './json-shapes.js'
import type { SecretException } from './secret-policy.js'
import type { VulnerabilityException } from './vulnerability-policy.js'

/**
 * How a declared exclusion's pattern is matched against a path. The settings that carry each kind know
 * it at the point they are read, which is the only place the answer is not a guess: `^\.vale/styles/`
 * and `src/app/**` are both plausible-looking strings and neither matches under the other's rules.
 */
export type ExclusionKind = 'regex' | 'glob' | 'route'

/** One exclusion a project declared, and the file role it claims. */
export interface DeclaredExclusion {
  /** Which setting it came from, so a finding can name it. */
  readonly setting: string
  readonly pattern: string
  readonly reason: string
  readonly kind: ExclusionKind
}

/**
 * One anonymous permission a project grants on purpose, with the reason it does.
 *
 * The managed access-boundary sweep asks the running application what it grants an unauthenticated
 * caller and fails on what it finds. Some grants are the point of the site - a published page a
 * stranger must be able to read, a contact form a stranger must be able to submit - so a project
 * records those here and the sweep passes them. An entry missing any field is dropped, which restores
 * the finding rather than widening the sweep, which is the safe direction to fail in.
 */
export interface PublicAccess {
  /** The collection or global slug, as Payload itself reports it. */
  readonly entity: string
  /** The operation granted: create, read, update, or delete. */
  readonly operation: string
  readonly reason: string
}

/** A managed path a project has taken over from the catalogue, with the reason it did so. */
export interface UnmanagedAsset {
  readonly path: string
  readonly reason: string
}

/**
 * A server the project's own end-to-end specs need beside the application under test.
 *
 * It carries no `reason`, unlike an exclusion. An exclusion without one is dropped because a dropped
 * exclusion widens what a gate judges, which is the safe direction to fail in; a dropped server would
 * instead leave a spec failing against a port nothing is listening on, which is a confusing failure
 * rather than a strict one. This is a fact ploaness cannot know, like {@link Settings.serverUrl}, not a
 * carve-out the project has to justify.
 */
export interface AuxiliaryServer {
  /** The command that starts it, as Playwright takes it: one string rather than an argv list. */
  readonly command: string
  /** The origin Playwright waits for before the suite starts. */
  readonly url: string
}

/** The parameters a consuming project may declare under the `ploaness` key of its package.json. */
export interface Settings {
  /** Directories holding first-party source, used by the convention and coverage gates. */
  readonly sourceRoots: readonly string[]
  /** Managed paths the project owns instead, each with a recorded reason. */
  readonly unmanagedAssets: readonly UnmanagedAsset[]
  /** Repo-relative path patterns exempt from the typography ban (generated files only). */
  readonly typographyExclusions: readonly string[]
  /**
   * Paths holding framework-generated scaffolding, which the lint pass relaxes rather than judges.
   *
   * The relaxation set is real and correct; expressing it only as `src/app/(payload)/**` made it
   * unreachable for anything else. A Next application that is not a Payload one has route handlers and
   * layouts with exactly the same property - written by a framework to a shape a project does not
   * choose - and no way to say so. Additive to the Payload paths, so declaring nothing keeps the
   * contract a Payload project already had.
   */
  readonly frameworkGlue: readonly string[]
  /**
   * Directories that form the pure-logic floor: they may depend on nothing else under the source root.
   *
   * The architecture contract calls the layer map "the one genuinely project-shaped part" and then
   * hard-coded it to `src/access` and `src/lib`. A project placing pure logic elsewhere had no way to
   * state that without owning a forbidden file. Additive, so the shipped floor still holds.
   */
  readonly pureLogicRoots: readonly string[]
  /** Every exclusion the project declared, honoured or not, so a gate can judge them. */
  readonly declaredExclusions: readonly DeclaredExclusion[]
  /** Repo-relative path patterns exempt from the hand-written-JavaScript ban. */
  readonly javascriptAllowlist: readonly string[]
  /** Glob patterns excluded from coverage measurement, by role rather than by convenience. */
  readonly coverageExclude: readonly string[]
  /** Ceiling for total gzipped client JavaScript, in bytes. */
  readonly bundleBudgetBytes: number
  /** A stricter suppression ceiling than the earned one, or undefined to accept the earned ceiling. */
  readonly maxSuppressions: number | undefined
  /** A stricter advisory severity than the shipped one, or undefined to accept the shipped one. */
  readonly vulnerabilitySeverity: string | undefined
  /** Recorded exceptions for advisories the project cannot reach. */
  readonly vulnerabilityAllowlist: readonly VulnerabilityException[]
  /** Committed fake credentials the secret scan excuses, each with the reason it is committed. */
  readonly secretAllowlist: readonly SecretException[]
  /** Anonymous permissions the project grants deliberately, each with the reason it does. */
  readonly publicAccess: readonly PublicAccess[]
  /**
   * A command run once before the test and end-to-end gates, as argv. A Payload project needs a database
   * before its suite can boot, and how it obtains one (a compose service, a managed instance, an
   * ephemeral schema) is a fact ploaness cannot know. Declaring it does not weaken a rule: the gates and
   * their thresholds are unchanged, only the way the project reaches its database.
   */
  readonly pretest: readonly string[]
  /** An argv prefix wrapping the test runner, for a project that runs its suite against a scratch database. */
  readonly testWrapper: readonly string[]
  /**
   * The origin the end-to-end suite drives. The port a project serves on is a fact ploaness cannot
   * know, and naming it weakens no rule: the suite, its browser and its assertions are unchanged.
   */
  readonly serverUrl: string
  /**
   * Servers the end-to-end run starts beside the application, for a project whose own specs drive one.
   * The application under test is unchanged, and so is every rule applied to it: a declared server is
   * added to the run rather than substituted for it, and the pinned accessibility sweep still drives
   * {@link Settings.serverUrl}. Which auxiliary process a project's specs need is a fact ploaness
   * cannot know, and the re-exported Playwright config leaves the project no other way to say so.
   */
  readonly auxiliaryServers: readonly AuxiliaryServer[]
  /**
   * Route prefixes the accessibility crawl must not follow, on top of the ones every Payload project
   * carries. A project that mounts its admin panel elsewhere has to say so or the crawl walks into it.
   */
  readonly accessibilitySkipRoutes: readonly string[]
  /**
   * Placeholder environment supplied to the gates that must IMPORT the project to analyse it. A Payload
   * config validates `process.env` at module scope, so a purely static analyser cannot load it in a bare
   * shell. These values are never connected to and never read as real configuration; they only let the
   * module evaluate. Declaring one weakens no rule, and a gate that actually runs the application
   * (`build`, `tests`, `e2e`) ignores this and uses the real environment.
   */
  readonly analysisEnv: Readonly<Record<string, string>>
}

// Imported rather than recomputed. The same three lines stood here and in `bundle-budget.ts`, which is
// the module that owns this number - two arithmetic expressions that had to agree, in a package whose
// own guidance says a value stated twice will not stay stated twice.
const DEFAULT_BUNDLE_BUDGET_BYTES: number = BUNDLE_BUDGET_BYTES

// The two variables Payload itself requires of every project. They are defaults rather than a hard-coded
// environment, so a project whose config demands more can add to them, but no project has to restate what
// Payload already mandates. Both are inert placeholders: no host is contacted and no secret is signed.
const DEFAULT_ANALYSIS_ENV: Readonly<Record<string, string>> = {
  PAYLOAD_SECRET: 'ploaness-static-analysis-placeholder',
  DATABASE_URL: 'postgres://127.0.0.1:5432/ploaness-static-analysis',
}

// Generated artefacts every Payload project carries. They are defaults rather than hard-coded skips, so
// a project that renames them can declare its own, but no project has to restate the obvious.
// The scaffolding Payload generates. A project declaring nothing is held to exactly this, which is the
// set that shipped before the role was declarable.
const DEFAULT_FRAMEWORK_GLUE: readonly string[] = ['src/app/(payload)/**', 'src/payload.config.ts']

/** The pure-logic floor a Payload project has by convention. */
const DEFAULT_PURE_LOGIC_ROOTS: readonly string[] = ['src/access', 'src/lib']

const DEFAULT_TYPOGRAPHY_EXCLUSIONS: readonly string[] = [
  String.raw`^\.claude/`,
  String.raw`^src/payload-types\.ts$`,
  String.raw`^src/payload-generated-schema\.ts$`,
  String.raw`importMap\.js$`,
]

const DEFAULT_JAVASCRIPT_ALLOWLIST: readonly string[] = [
  String.raw`^eslint\.config\.mjs$`,
  String.raw`importMap\.js$`,
]

/**
 * The directories a project holds first-party source in unless it says otherwise.
 *
 * Exported because `config-references.ts` built its own alternation out of the same names, and a
 * project that declared an extra source root got its config carve-outs left unchecked while the two
 * lists drifted apart in silence.
 */
export const DEFAULT_SOURCE_ROOTS: readonly string[] = ['src', 'tests', 'scripts']

const DEFAULT_SERVER_URL: string = 'http://localhost:3000'

// Payload's admin panel and REST API. Neither is a public page, both are reachable from a link on one,
// and axe run against the admin bundle judges Payload's markup rather than the project's. A project
// that moved either route adds its own; no project may take these away.
const DEFAULT_SKIPPED_ROUTES: readonly string[] = ['/admin', '/api']

// Roles that carry no unit-test seam in any Payload application: framework glue verified end to end,
// generated files, and operational data scripts. A project adds to this; it never shrinks it.
/**
 * The files the coverage report measures. Declared here rather than in the Vitest config because two
 * things need to agree about it: the config that produces the report, and the rule that judges whether
 * a declared exclusion reaches anything the report measured. Two literals that must stay equal will not.
 */
export const COVERAGE_INCLUDE: readonly string[] = ['src/**/*.ts', 'scripts/**/*.ts']

const DEFAULT_COVERAGE_EXCLUDE: readonly string[] = [
  'src/app/**',
  'src/payload.config.ts',
  'src/payload-types.ts',
  'src/seed/**',
  'src/**/*.d.ts',
  'src/**/*.tsx',
]

const isTextArray = (raw: unknown): raw is readonly string[] =>
  isArray(raw) && raw.every((entry: unknown): boolean => typeof entry === 'string')

const asStringArray = (raw: unknown, fallback: readonly string[]): readonly string[] =>
  isTextArray(raw) ? raw : fallback

const asPositiveInteger = (raw: unknown, fallback: number): number =>
  typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? raw : fallback

// Zero is a meaningful value here, not a missing one: "no suppression is permitted" is a position a
// project may take, so this cannot reuse asPositiveInteger. Undefined means the project declares no
// cap of its own and the earned ceiling applies.
const asNonNegativeInteger = (raw: unknown): number | undefined =>
  typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : undefined

// An entry without a non-empty reason is dropped rather than honoured: taking over a managed path is a
// decision the project must record, so an unexplained entry must not weaken the asset gate.
const asUnmanagedAssets = (raw: unknown): readonly UnmanagedAsset[] =>
  isArray(raw)
    ? raw.flatMap((entry: unknown): readonly UnmanagedAsset[] => {
        const record: Record<string, unknown> = asRecord(entry)
        const path: string = asText(record['path'])
        const reason: string = asText(record['reason'])
        return path.length > 0 && reason.trim().length > 0 ? [{ path, reason }] : []
      })
    : []

// Both halves are load-bearing: a command with no url gives Playwright nothing to wait for, and a url
// with no command names a server nobody starts. An incomplete entry is dropped rather than half-honoured,
// because starting a process the suite then cannot reach is the one outcome worse than not starting it.
const asAuxiliaryServers = (raw: unknown): readonly AuxiliaryServer[] =>
  isArray(raw)
    ? raw.flatMap((entry: unknown): readonly AuxiliaryServer[] => {
        const record: Record<string, unknown> = asRecord(entry)
        const command: string = asText(record['command']).trim()
        const url: string = asText(record['url']).trim()
        return command.length > 0 && url.length > 0 ? [{ command, url }] : []
      })
    : []

// An advisory date must be recorded as a date. An entry whose reason or date is missing or malformed is
// dropped rather than honoured, so a typo re-exposes the finding instead of quietly excusing it.
const ISO_DATE: RegExp = /^\d{4}-\d{2}-\d{2}$/

const asVulnerabilityAllowlist = (raw: unknown): readonly VulnerabilityException[] =>
  isArray(raw)
    ? raw.flatMap((entry: unknown): readonly VulnerabilityException[] => {
        const record: Record<string, unknown> = asRecord(entry)
        const advisory: string = asText(record['advisory']).trim()
        const reason: string = asText(record['reason']).trim()
        const addedOn: string = asText(record['addedOn'])
        const isRecorded: boolean =
          advisory.length > 0 && reason.length > 0 && ISO_DATE.test(addedOn)
        return isRecorded ? [{ advisory, reason, addedOn }] : []
      })
    : []

// An unexplained exception is dropped, exactly as an unexplained managed-path takeover is: a fixture
// credential is a decision the project must record, and a typo must re-expose the finding rather than
// quietly widen the scan.
const asSecretAllowlist = (raw: unknown): readonly SecretException[] =>
  isArray(raw)
    ? raw.flatMap((entry: unknown): readonly SecretException[] => {
        const record: Record<string, unknown> = asRecord(entry)
        const filePath: string = asText(record['path']).trim()
        const reason: string = asText(record['reason']).trim()
        return filePath.length > 0 && reason.length > 0 ? [{ path: filePath, reason }] : []
      })
    : []

// Dropped on any missing field, for the reason an unexplained secret exception is dropped: a granted
// anonymous permission is a decision the project must record, and a typo must re-expose the finding
// rather than quietly excuse a permission nobody chose.
const asPublicAccess = (raw: unknown): readonly PublicAccess[] =>
  isArray(raw)
    ? raw.flatMap((entry: unknown): readonly PublicAccess[] => {
        const record: Record<string, unknown> = asRecord(entry)
        const entity: string = asText(record['entity']).trim()
        const operation: string = asText(record['operation']).trim()
        const reason: string = asText(record['reason']).trim()
        return entity.length > 0 && operation.length > 0 && reason.length > 0
          ? [{ entity, operation, reason }]
          : []
      })
    : []

// An exclusion narrows a gate's scope, which is the one thing the standard says a project's settings
// may not do without the harness's leave. The leave it grants is an exclusion by file role - so an
// entry states the role it is claiming, and an entry that states none is dropped rather than honoured.
// A dropped entry makes the gate stricter, which is the safe direction to fail in.
const asDeclaredExclusions = (
  raw: unknown,
  setting: string,
  kind: ExclusionKind,
): readonly DeclaredExclusion[] =>
  isArray(raw)
    ? raw.map((entry: unknown): DeclaredExclusion => readExclusion(entry, setting, kind))
    : []

// A bare string is kept with an empty reason rather than dropped silently, so the gate can name the
// entry the project wrote instead of reporting that its exclusions simply stopped applying.
const readExclusion = (entry: unknown, setting: string, kind: ExclusionKind): DeclaredExclusion => {
  if (typeof entry === 'string') {
    return { setting, pattern: entry, reason: '', kind }
  }
  if (!isRecord(entry)) {
    return { setting, pattern: '', reason: '', kind }
  }
  return {
    setting,
    pattern: asText(entry['pattern']),
    reason: asText(entry['reason']).trim(),
    kind,
  }
}

const honoured = (entries: readonly DeclaredExclusion[]): readonly string[] =>
  entries
    .filter(
      (entry: DeclaredExclusion): boolean => entry.pattern.length > 0 && entry.reason.length > 0,
    )
    .map((entry: DeclaredExclusion): string => entry.pattern)

/** The four exclusion lists a project may declare, each read under the matching kind its setting uses. */
interface DeclaredLists {
  readonly typography: readonly DeclaredExclusion[]
  readonly javascript: readonly DeclaredExclusion[]
  readonly coverage: readonly DeclaredExclusion[]
  readonly routes: readonly DeclaredExclusion[]
  readonly glue: readonly DeclaredExclusion[]
  readonly layers: readonly DeclaredExclusion[]
}

// The kind travels with the setting because this is the only place the answer is not a guess: by the
// time a rule holds the entry, `^\.vale/styles/` and `src/app/**` are two strings that look alike.
const readDeclaredLists = (raw: Record<string, unknown>): DeclaredLists => ({
  typography: asDeclaredExclusions(raw['typographyExclusions'], 'typographyExclusions', 'regex'),
  javascript: asDeclaredExclusions(raw['javascriptAllowlist'], 'javascriptAllowlist', 'regex'),
  coverage: asDeclaredExclusions(raw['coverageExclude'], 'coverageExclude', 'glob'),
  routes: asDeclaredExclusions(raw['accessibilitySkipRoutes'], 'accessibilitySkipRoutes', 'route'),
  glue: asDeclaredExclusions(raw['frameworkGlue'], 'frameworkGlue', 'glob'),
  layers: asDeclaredExclusions(raw['pureLogicRoots'], 'pureLogicRoots', 'glob'),
})

/**
 * Read the `ploaness` key of a parsed package.json into a fully defaulted settings object. A malformed
 * value falls back to the strict default rather than failing the read, so a typo can never widen a rule.
 * @param packageJson the parsed package.json of the consuming project.
 * @returns the effective settings, with every field populated.
 */
export const readSettings = (packageJson: unknown): Settings => {
  const raw: Record<string, unknown> = asRecord(asRecord(packageJson)['ploaness'])
  const {
    typography: declaredTypography,
    javascript: declaredJavascript,
    coverage: declaredCoverage,
    routes: declaredRoutes,
    glue: declaredGlue,
    layers: declaredLayers,
  }: DeclaredLists = readDeclaredLists(raw)
  return {
    // Additive, like every other list field. Replacing the default let a project declare `["src"]` and
    // silently drop `tests` and `scripts` from the conventions, payload-rules, suppressions, css and
    // architecture gates - a scope narrowing the harness is supposed to refuse.
    sourceRoots: [
      ...new Set<string>([...DEFAULT_SOURCE_ROOTS, ...asStringArray(raw['sourceRoots'], [])]),
    ],
    unmanagedAssets: asUnmanagedAssets(raw['unmanagedAssets']),
    typographyExclusions: [...DEFAULT_TYPOGRAPHY_EXCLUSIONS, ...honoured(declaredTypography)],
    frameworkGlue: [...DEFAULT_FRAMEWORK_GLUE, ...honoured(declaredGlue)],
    pureLogicRoots: [...DEFAULT_PURE_LOGIC_ROOTS, ...honoured(declaredLayers)],
    declaredExclusions: [
      ...declaredTypography,
      ...declaredJavascript,
      ...declaredCoverage,
      ...declaredRoutes,
      ...declaredGlue,
      ...declaredLayers,
    ],
    javascriptAllowlist: [...DEFAULT_JAVASCRIPT_ALLOWLIST, ...honoured(declaredJavascript)],
    coverageExclude: [...DEFAULT_COVERAGE_EXCLUDE, ...honoured(declaredCoverage)],
    // Only a stricter budget is honoured. A project could otherwise declare a budget large enough to
    // pass anything, which is a threshold the harness owns rather than one it leaves open.
    bundleBudgetBytes: Math.min(
      DEFAULT_BUNDLE_BUDGET_BYTES,
      asPositiveInteger(raw['bundleBudgetBytes'], DEFAULT_BUNDLE_BUDGET_BYTES),
    ),
    maxSuppressions: asNonNegativeInteger(raw['maxSuppressions']),
    vulnerabilitySeverity:
      typeof raw['vulnerabilitySeverity'] === 'string' ? raw['vulnerabilitySeverity'] : undefined,
    vulnerabilityAllowlist: asVulnerabilityAllowlist(raw['vulnerabilityAllowlist']),
    secretAllowlist: asSecretAllowlist(raw['secretAllowlist']),
    publicAccess: asPublicAccess(raw['publicAccess']),
    pretest: asStringArray(raw['pretest'], []),
    testWrapper: asStringArray(raw['testWrapper'], []),
    serverUrl: typeof raw['serverUrl'] === 'string' ? raw['serverUrl'] : DEFAULT_SERVER_URL,
    auxiliaryServers: asAuxiliaryServers(raw['auxiliaryServers']),
    accessibilitySkipRoutes: [...DEFAULT_SKIPPED_ROUTES, ...honoured(declaredRoutes)],
    analysisEnv: { ...DEFAULT_ANALYSIS_ENV, ...asStringRecord(raw['analysisEnv']) },
  }
}

/**
 * Report every declared exclusion the harness cannot honour.
 *
 * This once also refused an entry whose pattern named a single existing file, on the reading that one
 * path is not a role. The governing standard now judges an exclusion by what it REACHES rather than by
 * how specific it looks, and `findUnreachedExclusions` below is that rule. A named file the report
 * measured excludes something; the defect the standard names is an entry that excludes nothing.
 * @param entries the exclusions the project declared.
 * @returns one message per entry that states no role.
 */
export const findConvenienceExclusions = (
  entries: readonly DeclaredExclusion[],
): readonly string[] =>
  entries.flatMap((entry: DeclaredExclusion): readonly string[] =>
    entry.reason.length === 0
      ? [
          `${entry.setting} entry "${entry.pattern}" states no reason; ` +
            'an exclusion is granted by file role, so the role must be written down',
        ]
      : [],
  )

/**
 * Report every declared exclusion that matches none of the paths it could have excluded.
 *
 * An exclusion that reaches nothing leaves the report reading exactly as it would have read without it,
 * so it records a decision nobody can see the effect of - and it outlives the file it was written for,
 * which is how a stale carve-out survives the rename that made it meaningless. A route exclusion is
 * skipped: it names a URL the crawl must not follow, and no path in the repository can confirm it.
 * @param entries the exclusions the project declared.
 * @param candidates the repo-relative paths the corresponding gate would otherwise have judged.
 * @returns one message per entry that reaches nothing.
 */
export const findUnreachedExclusions = (
  entries: readonly DeclaredExclusion[],
  candidates: readonly string[],
): readonly string[] =>
  entries
    .filter(
      (entry: DeclaredExclusion): boolean =>
        entry.kind !== 'route' && entry.pattern.length > 0 && entry.reason.length > 0,
    )
    .filter((entry: DeclaredExclusion): boolean => !reachesAny(entry, candidates))
    .map(
      (entry: DeclaredExclusion): string =>
        `${entry.setting} entry "${entry.pattern}" excludes nothing; ` +
        'it matches no file the gate would have judged, so it records a decision with no effect',
    )

const reachesAny = (entry: DeclaredExclusion, candidates: readonly string[]): boolean =>
  candidates.some((candidate: string): boolean =>
    entry.kind === 'glob'
      ? matchesGlob(entry.pattern, candidate)
      : matchesRole(candidate, [entry.pattern]),
  )
