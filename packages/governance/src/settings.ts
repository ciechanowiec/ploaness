// Consumer-declared parameters. A project
// declares them under a `ploaness` key in its package.json. Every field is optional and every default is
// deliberately strict, so a project that declares nothing still receives the full contract.
//
// The set is intentionally small. ploaness owns the rules; a project may declare only the facts ploaness
// cannot know for it: where its sources live, which generated file a rule must skip, how large its
// bundle may grow. There is no field that turns a gate off, because "do not disable the failing check"
// is the contract rather than a preference.

import type { SecretException } from './secret-policy.js'
import type { VulnerabilityException } from './vulnerability-policy.js'

/** One exclusion a project declared, and the file role it claims. */
export interface DeclaredExclusion {
  /** Which setting it came from, so a finding can name it. */
  readonly setting: string
  readonly pattern: string
  readonly reason: string
}

/** A managed path a project has taken over from the catalogue, with the reason it did so. */
export interface UnmanagedAsset {
  readonly path: string
  readonly reason: string
}

/** The parameters a consuming project may declare under the `ploaness` key of its package.json. */
export interface Settings {
  /** Directories holding first-party source, used by the convention and coverage gates. */
  readonly sourceRoots: readonly string[]
  /** Managed paths the project owns instead, each with a recorded reason. */
  readonly unmanagedAssets: readonly UnmanagedAsset[]
  /** Repo-relative path patterns exempt from the typography ban (generated files only). */
  readonly typographyExclusions: readonly string[]
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
   * Placeholder environment supplied to the gates that must IMPORT the project to analyse it. A Payload
   * config validates `process.env` at module scope, so a purely static analyser cannot load it in a bare
   * shell. These values are never connected to and never read as real configuration; they only let the
   * module evaluate. Declaring one weakens no rule, and a gate that actually runs the application
   * (`build`, `tests`, `e2e`) ignores this and uses the real environment.
   */
  readonly analysisEnv: Readonly<Record<string, string>>
}

const BYTES_PER_KIB: number = 1024
const DEFAULT_BUDGET_KIB: number = 900
const DEFAULT_BUNDLE_BUDGET_BYTES: number = DEFAULT_BUDGET_KIB * BYTES_PER_KIB

// The two variables Payload itself requires of every project. They are defaults rather than a hard-coded
// environment, so a project whose config demands more can add to them, but no project has to restate what
// Payload already mandates. Both are inert placeholders: no host is contacted and no secret is signed.
const DEFAULT_ANALYSIS_ENV: Readonly<Record<string, string>> = {
  PAYLOAD_SECRET: 'ploaness-static-analysis-placeholder',
  DATABASE_URL: 'postgres://127.0.0.1:5432/ploaness-static-analysis',
}

// Generated artefacts every Payload project carries. They are defaults rather than hard-coded skips, so
// a project that renames them can declare its own, but no project has to restate the obvious.
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

const DEFAULT_SOURCE_ROOTS: readonly string[] = ['src', 'tests', 'scripts']

// Roles that carry no unit-test seam in any Payload application: framework glue verified end to end,
// generated files, and operational data scripts. A project adds to this; it never shrinks it.
const DEFAULT_COVERAGE_EXCLUDE: readonly string[] = [
  'src/app/**',
  'src/payload.config.ts',
  'src/payload-types.ts',
  'src/seed/**',
  'src/**/*.d.ts',
  'src/**/*.tsx',
]

const asStringArray = (raw: unknown, fallback: readonly string[]): readonly string[] =>
  Array.isArray(raw) && raw.every((entry: unknown): boolean => typeof entry === 'string')
    ? (raw as readonly string[])
    : fallback

const asPositiveInteger = (raw: unknown, fallback: number): number =>
  typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? raw : fallback

// Zero is a meaningful value here, not a missing one: "no suppression is permitted" is a position a
// project may take, so this cannot reuse asPositiveInteger. Undefined means the project declares no
// cap of its own and the earned ceiling applies.
const asNonNegativeInteger = (raw: unknown): number | undefined =>
  typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : undefined

// An entry without a non-empty reason is dropped rather than honoured: taking over a managed path is a
// decision the project must record, so an unexplained entry must not weaken the asset gate.
const asUnmanagedAssets = (raw: unknown): readonly UnmanagedAsset[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.flatMap((entry: unknown): readonly UnmanagedAsset[] => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }
    const record: Record<string, unknown> = entry as Record<string, unknown>
    const path: unknown = record['path']
    const reason: unknown = record['reason']
    return typeof path === 'string' && typeof reason === 'string' && reason.trim().length > 0
      ? [{ path, reason }]
      : []
  })
}

// An advisory date must be recorded as a date. An entry whose reason or date is missing or malformed is
// dropped rather than honoured, so a typo re-exposes the finding instead of quietly excusing it.
const ISO_DATE: RegExp = /^\d{4}-\d{2}-\d{2}$/

const isNonEmptyText = (raw: unknown): boolean => typeof raw === 'string' && raw.trim().length > 0

const isRecordedDate = (raw: unknown): boolean => typeof raw === 'string' && ISO_DATE.test(raw)

const asVulnerabilityAllowlist = (raw: unknown): readonly VulnerabilityException[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.flatMap((entry: unknown): readonly VulnerabilityException[] => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }
    const record: Record<string, unknown> = entry as Record<string, unknown>
    const advisory: unknown = record['advisory']
    const reason: unknown = record['reason']
    const addedOn: unknown = record['addedOn']
    const isRecorded: boolean =
      isNonEmptyText(advisory) && isNonEmptyText(reason) && isRecordedDate(addedOn)
    return isRecorded
      ? [{ advisory: advisory as string, reason: reason as string, addedOn: addedOn as string }]
      : []
  })
}

// An unexplained exception is dropped, exactly as an unexplained managed-path takeover is: a fixture
// credential is a decision the project must record, and a typo must re-expose the finding rather than
// quietly widen the scan.
const asSecretAllowlist = (raw: unknown): readonly SecretException[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.flatMap((entry: unknown): readonly SecretException[] => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }
    const record: Record<string, unknown> = entry as Record<string, unknown>
    const filePath: unknown = record['path']
    const reason: unknown = record['reason']
    const isRecorded: boolean =
      typeof filePath === 'string' &&
      typeof reason === 'string' &&
      filePath.trim().length > 0 &&
      reason.trim().length > 0
    return isRecorded ? [{ path: filePath as string, reason: reason as string }] : []
  })
}

// An exclusion narrows a gate's scope, which is the one thing the standard says a project's settings
// may not do without the harness's leave. The leave it grants is an exclusion by file role - so an
// entry states the role it is claiming, and an entry that states none is dropped rather than honoured.
// A dropped entry makes the gate stricter, which is the safe direction to fail in.
const asDeclaredExclusions = (raw: unknown, setting: string): readonly DeclaredExclusion[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.map((entry: unknown): DeclaredExclusion => readExclusion(entry, setting))
}

// A bare string is kept with an empty reason rather than dropped silently, so the gate can name the
// entry the project wrote instead of reporting that its exclusions simply stopped applying.
const readExclusion = (entry: unknown, setting: string): DeclaredExclusion => {
  if (typeof entry === 'string') {
    return { setting, pattern: entry, reason: '' }
  }
  if (typeof entry !== 'object' || entry === null) {
    return { setting, pattern: '', reason: '' }
  }
  const record: Record<string, unknown> = entry as Record<string, unknown>
  return {
    setting,
    pattern: asText(record['pattern']),
    reason: asText(record['reason']).trim(),
  }
}

const asText = (raw: unknown): string => (typeof raw === 'string' ? raw : '')

const honoured = (entries: readonly DeclaredExclusion[]): readonly string[] =>
  entries
    .filter(
      (entry: DeclaredExclusion): boolean => entry.pattern.length > 0 && entry.reason.length > 0,
    )
    .map((entry: DeclaredExclusion): string => entry.pattern)

const asRecord = (raw: unknown): Record<string, unknown> =>
  typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}

// Only string-valued entries survive: a non-string would reach `spawn` as a malformed environment.
const asStringRecord = (raw: unknown): Readonly<Record<string, string>> => {
  return Object.fromEntries(
    Object.entries(asRecord(raw)).filter(
      ([, value]: readonly [string, unknown]): boolean => typeof value === 'string',
    ),
  ) as Record<string, string>
}

/**
 * Read the `ploaness` key of a parsed package.json into a fully defaulted settings object. A malformed
 * value falls back to the strict default rather than failing the read, so a typo can never widen a rule.
 * @param packageJson the parsed package.json of the consuming project.
 * @returns the effective settings, with every field populated.
 */
export const readSettings = (packageJson: unknown): Settings => {
  const raw: Record<string, unknown> = asRecord(asRecord(packageJson)['ploaness'])
  const declaredTypography: readonly DeclaredExclusion[] = asDeclaredExclusions(
    raw['typographyExclusions'],
    'typographyExclusions',
  )
  const declaredJavascript: readonly DeclaredExclusion[] = asDeclaredExclusions(
    raw['javascriptAllowlist'],
    'javascriptAllowlist',
  )
  const declaredCoverage: readonly DeclaredExclusion[] = asDeclaredExclusions(
    raw['coverageExclude'],
    'coverageExclude',
  )
  return {
    // Additive, like every other list field. Replacing the default let a project declare `["src"]` and
    // silently drop `tests` and `scripts` from the conventions, payload-rules, suppressions, css and
    // architecture gates - a scope narrowing the harness is supposed to refuse.
    sourceRoots: [
      ...new Set<string>([...DEFAULT_SOURCE_ROOTS, ...asStringArray(raw['sourceRoots'], [])]),
    ],
    unmanagedAssets: asUnmanagedAssets(raw['unmanagedAssets']),
    typographyExclusions: [...DEFAULT_TYPOGRAPHY_EXCLUSIONS, ...honoured(declaredTypography)],
    declaredExclusions: [...declaredTypography, ...declaredJavascript, ...declaredCoverage],
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
    pretest: asStringArray(raw['pretest'], []),
    testWrapper: asStringArray(raw['testWrapper'], []),
    analysisEnv: { ...DEFAULT_ANALYSIS_ENV, ...asStringRecord(raw['analysisEnv']) },
  }
}

// Characters that make a pattern describe a shape rather than one named thing. A pattern with none of
// them, that resolves to a file which exists, is not a role: it is one file the project would rather
// not be judged on, which is the exclusion by convenience the standard refuses.
const PATTERN_METACHARACTERS: RegExp = /[*?[\]{}()|+^$\\]/

/**
 * Report every declared exclusion the harness cannot honour.
 * @param entries the exclusions the project declared.
 * @param isExistingPath whether a path exists in the working tree, injected so this stays pure.
 * @returns one message per entry that states no role, or that names a single existing file.
 */
export const findConvenienceExclusions = (
  entries: readonly DeclaredExclusion[],
  isExistingPath: (path: string) => boolean,
): readonly string[] =>
  entries.flatMap((entry: DeclaredExclusion): readonly string[] => {
    if (entry.reason.length === 0) {
      return [
        `${entry.setting} entry "${entry.pattern}" states no reason; ` +
          'an exclusion is granted by file role, so the role must be written down',
      ]
    }
    return !PATTERN_METACHARACTERS.test(entry.pattern) && isExistingPath(entry.pattern)
      ? [
          `${entry.setting} entry "${entry.pattern}" names one existing file rather than a role; ` +
            'exclude the role that file plays, or test it',
        ]
      : []
  })
