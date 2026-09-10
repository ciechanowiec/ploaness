// The checkov checks this harness enables, the reason each one is on the list, and the standing of
// every provider a tree may declare.
//
// Specific validated rules at error severity, never a whole category. A category enables checks nobody
// read, and a rule count is not coverage - so each id here names a defect a governed project must not
// ship, with the reason it is refused written beside it. Consumers get no per-check opt-out, so every
// id is held to one rubric and fails it on the first miss:
//
// - R1 A defect in every environment: wrong in dev, stage, prod and an ephemeral preview alike. That
//   excludes logging, backups, retention, deletion protection, high availability, tags and "latest
//   version" - each states how an environment is RUN rather than a defect in how it is written.
// - R2 Deterministic from the resource graph: no heuristic, no free-text match, no entropy.
// - R3 Repaired by one free argument on the same resource: no customer-managed key, log bucket, WAF,
//   NAT or private endpoint. Default-managed encryption at rest is in; customer-managed keys are out.
// - R4 Reads the argument the CURRENT provider uses, and fails no correct configuration: a check that
//   knows only a renamed argument, or fails an absent one whose default is already the secure value,
//   blocks a project for being right.
// - R5 Never refuses the correct state of a public website: an internet-facing edge, 0.0.0.0/0 on 80
//   and 443, a public Cloud Run invoker are correct; a public database or SSH from the world is not.
//
// Every id was confirmed present in the PINNED image with `--list`. That check is not ceremony: a
// `--check` id that does not exist matches nothing and raises no error, so a typo would silently
// disable a rule while the run still passed. The digest pin is what keeps the audit durable, because
// the catalogue cannot change underneath it - which also means the audit is redone when the pin moves.
//
// Three AWS checks passed every criterion but R1, and are the first of a policy tranche should the
// fleet ever adopt an operational baseline: `CKV_AWS_133` (backup retention) and `CKV_AWS_139` /
// `CKV_AWS_293` (deletion protection on a cluster and on an instance). A deliberately ephemeral stage
// environment fails all three on its first day.

/** A provider this harness has curated checks for. Widened as each cloud's audit lands. */
export type CuratedProviderName = 'aws'

/** One enabled check: the identifier checkov knows it by, its provider, and why the finding is refused. */
export interface CheckovCheck {
  readonly id: string
  readonly provider: CuratedProviderName
  readonly reason: string
}

/** The checks enabled at error severity, each confirmed present in the pinned image. */
export const CHECKOV_CHECKS: readonly CheckovCheck[] = [
  {
    id: 'CKV_AWS_274',
    provider: 'aws',
    reason:
      'a role, user or group carries AdministratorAccess, so one environment can destroy another',
  },
  {
    id: 'CKV_AWS_275',
    provider: 'aws',
    reason: 'the same administrator policy reached through a data source rather than an attachment',
  },
  {
    id: 'CKV_AWS_1',
    provider: 'aws',
    reason: 'a policy document grants every action on every resource',
  },
  {
    id: 'CKV_AWS_49',
    provider: 'aws',
    reason: 'a policy document names "*" as a statement action',
  },
  {
    id: 'CKV_AWS_62',
    provider: 'aws',
    reason: 'the same administrative grant written as an inline policy',
  },
  {
    id: 'CKV_AWS_63',
    provider: 'aws',
    reason: 'the same wildcard action written as an inline policy',
  },
  {
    id: 'CKV_AWS_41',
    provider: 'aws',
    reason: 'a long-lived access key is written into a provider block',
  },
  {
    id: 'CKV_AWS_17',
    provider: 'aws',
    reason: 'the database is reachable from the public internet',
  },
  {
    id: 'CKV_AWS_16',
    provider: 'aws',
    reason: 'the database instance stores its content unencrypted',
  },
  {
    id: 'CKV_AWS_96',
    provider: 'aws',
    reason: 'the database cluster stores its content unencrypted',
  },
  {
    id: 'CKV_AWS_20',
    provider: 'aws',
    reason: 'a bucket ACL grants public read, which serves unpublished media to anybody',
  },
  {
    id: 'CKV_AWS_57',
    provider: 'aws',
    reason: 'a bucket ACL grants public write, which is arbitrary upload to the site own origin',
  },
  {
    id: 'CKV_AWS_70',
    provider: 'aws',
    reason:
      'a bucket policy names any principal, which is the policy spelling of the same exposure',
  },
  {
    id: 'CKV_AWS_19',
    provider: 'aws',
    reason: 'the bucket stores uploads unencrypted',
  },
  {
    id: 'CKV_AWS_53',
    provider: 'aws',
    reason: 'the bucket does not block public ACLs',
  },
  {
    id: 'CKV_AWS_54',
    provider: 'aws',
    reason: 'the bucket does not block a public policy',
  },
  {
    id: 'CKV_AWS_55',
    provider: 'aws',
    reason: 'the bucket does not ignore public ACLs already set',
  },
  {
    id: 'CKV_AWS_56',
    provider: 'aws',
    reason: 'the bucket does not restrict public access at the account boundary',
  },
  {
    id: 'CKV_AWS_24',
    provider: 'aws',
    reason: 'a security group admits SSH from the whole internet',
  },
  {
    id: 'CKV_AWS_25',
    provider: 'aws',
    reason: 'a security group admits RDP from the whole internet',
  },
  {
    id: 'CKV_AWS_79',
    provider: 'aws',
    reason: 'instance metadata v1 is enabled, so any request forgery becomes credential theft',
  },
]

/**
 * The value of checkov's `--check` flag.
 *
 * Read from the catalogue rather than written out, so the list that runs and the list that carries the
 * reasons cannot drift. An empty value would run EVERY check rather than none, which is why the spec
 * beside this asserts the catalogue is not empty.
 * @returns the enabled identifiers, comma separated.
 */
export const checkovCheckList = (): string =>
  CHECKOV_CHECKS.map((check: CheckovCheck): string => check.id).join(',')

// The tally checkov prints after a scan. Its compact output spends several lines on each failed check
// and a few on headers, so counting lines would report defects that are not there.
const FAILED_CHECKS: RegExp = /Failed checks: (?<count>\d+)/

/**
 * How many checks checkov reports as failed.
 * @param output the analyzer's output for a scan that found at least one resource.
 * @returns the tally, or undefined when the output carries none - which a caller treats as a run that
 * did not complete rather than as a clean one.
 */
export const failedCheckCount = (output: string): number | undefined => {
  const count: string | undefined = FAILED_CHECKS.exec(output)?.groups?.['count']
  return count === undefined ? undefined : Number(count)
}

/**
 * The checks that can apply to a set of providers.
 * @param providers provider names as the resource types spell them.
 * @returns every enabled check bound to one of them.
 */
export const checksFor = (providers: readonly string[]): readonly CheckovCheck[] =>
  CHECKOV_CHECKS.filter((check: CheckovCheck): boolean => providers.includes(check.provider))

/**
 * Why a provider has no enabled check. The summary says which, rather than claiming checks that could
 * not have run: a `--check` id bound to no resource in the tree matches nothing and raises no error, so
 * without this the analyzer exits 0 over a cloud it never looked at.
 */
export type ProviderStanding = 'utility' | 'unsupported' | 'audited'

/**
 * Every provider this harness knows to have no enabled check, and why. A provider on neither this map
 * nor the catalogue is refused: the harness cannot tell whether the analyzer covers it and does not
 * guess. The `unsupported` entries were confirmed absent from the pinned image with `--list`, and are
 * re-confirmed when the pin moves.
 */
export const PROVIDERS_WITHOUT_CHECKS: ReadonlyMap<string, ProviderStanding> = new Map<
  string,
  ProviderStanding
>([
  // Declares no cloud resource, so there is nothing for an analyzer to judge.
  ['random', 'utility'],
  ['null', 'utility'],
  ['local', 'utility'],
  ['tls', 'utility'],
  ['time', 'utility'],
  ['archive', 'utility'],
  ['external', 'utility'],
  ['http', 'utility'],
  ['template', 'utility'],
  ['cloudinit', 'utility'],
  ['terraform', 'utility'],
  // The pinned image ships no check for these. A project on one of them is judged by the pattern
  // rules alone, and the summary says so.
  ['hcloud', 'unsupported'],
  ['cloudflare', 'unsupported'],
  ['vercel', 'unsupported'],
  ['fly', 'unsupported'],
  ['render', 'unsupported'],
  ['scaleway', 'unsupported'],
  ['ovh', 'unsupported'],
  ['vultr', 'unsupported'],
  ['upcloud', 'unsupported'],
  ['exoscale', 'unsupported'],
  ['mongodbatlas', 'unsupported'],
  ['neon', 'unsupported'],
  ['helm', 'unsupported'],
])

/** The providers a tree declares, sorted into what the gate does about each. */
export interface ProviderClassification {
  /** At least one enabled check binds to it. */
  readonly curated: readonly string[]
  readonly utility: readonly string[]
  readonly unsupported: readonly string[]
  readonly audited: readonly string[]
  /** On no list; the gate refuses to guess. */
  readonly unclassified: readonly string[]
}

/**
 * The providers at least one enabled check binds to.
 *
 * Derived from the catalogue rather than declared beside it, so a cloud cannot be listed as curated
 * with nothing enabled for it.
 * @returns the provider names.
 */
export const curatedProviders = (): ReadonlySet<string> =>
  new Set(CHECKOV_CHECKS.map((check: CheckovCheck): string => check.provider))

const standingOf = (
  provider: string,
  curated: ReadonlySet<string>,
): keyof ProviderClassification =>
  curated.has(provider) ? 'curated' : (PROVIDERS_WITHOUT_CHECKS.get(provider) ?? 'unclassified')

/**
 * Sort the providers a tree declares by what the gate does about each.
 * @param detected provider names, in any order and with any repetition.
 * @returns each provider once, in its standing, ordered so a report reads the same on every machine.
 */
export const classifyProviders = (detected: readonly string[]): ProviderClassification => {
  const curated: ReadonlySet<string> = curatedProviders()
  const unique: readonly string[] = [...new Set(detected)].toSorted(
    (left: string, right: string): number => left.localeCompare(right),
  )
  const standing = (wanted: keyof ProviderClassification): readonly string[] =>
    unique.filter((provider: string): boolean => standingOf(provider, curated) === wanted)
  return {
    curated: standing('curated'),
    utility: standing('utility'),
    unsupported: standing('unsupported'),
    audited: standing('audited'),
    unclassified: standing('unclassified'),
  }
}
