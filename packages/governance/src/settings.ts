// Consumer-declared parameters. A project
// declares them under a `ploaness` key in its package.json. Every field is optional and every default is
// deliberately strict, so a project that declares nothing still receives the full contract.
//
// The set is intentionally small. ploaness owns the rules; a project may declare only the facts ploaness
// cannot know for it: where its sources live, which generated file a rule must skip, how large its
// bundle may grow. There is no field that turns a gate off, because "do not disable the failing check"
// is the contract rather than a preference.

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
  /** Repo-relative path patterns exempt from the hand-written-JavaScript ban. */
  readonly javascriptAllowlist: readonly string[]
  /** Glob patterns excluded from coverage measurement, by role rather than by convenience. */
  readonly coverageExclude: readonly string[]
  /** Ceiling for total gzipped client JavaScript, in bytes. */
  readonly bundleBudgetBytes: number
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

const DEFAULT_BUNDLE_BUDGET_BYTES: number = 900 * 1024

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
  typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : fallback

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

const asRecord = (raw: unknown): Record<string, unknown> =>
  typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}

// Only string-valued entries survive: a non-string would reach `spawn` as a malformed environment.
const asStringRecord = (raw: unknown): Readonly<Record<string, string>> => {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(asRecord(raw))) {
    if (typeof value === 'string') {
      result[key] = value
    }
  }
  return result
}

/**
 * Read the `ploaness` key of a parsed package.json into a fully defaulted settings object. A malformed
 * value falls back to the strict default rather than failing the read, so a typo can never widen a rule.
 * @param packageJson the parsed package.json of the consuming project.
 * @returns the effective settings, with every field populated.
 */
export const readSettings = (packageJson: unknown): Settings => {
  const raw: Record<string, unknown> = asRecord(asRecord(packageJson)['ploaness'])
  return {
    sourceRoots: asStringArray(raw['sourceRoots'], DEFAULT_SOURCE_ROOTS),
    unmanagedAssets: asUnmanagedAssets(raw['unmanagedAssets']),
    typographyExclusions: [
      ...DEFAULT_TYPOGRAPHY_EXCLUSIONS,
      ...asStringArray(raw['typographyExclusions'], []),
    ],
    javascriptAllowlist: [
      ...DEFAULT_JAVASCRIPT_ALLOWLIST,
      ...asStringArray(raw['javascriptAllowlist'], []),
    ],
    coverageExclude: [...DEFAULT_COVERAGE_EXCLUDE, ...asStringArray(raw['coverageExclude'], [])],
    bundleBudgetBytes: asPositiveInteger(raw['bundleBudgetBytes'], DEFAULT_BUNDLE_BUDGET_BYTES),
    pretest: asStringArray(raw['pretest'], []),
    testWrapper: asStringArray(raw['testWrapper'], []),
    analysisEnv: { ...DEFAULT_ANALYSIS_ENV, ...asStringRecord(raw['analysisEnv']) },
  }
}
