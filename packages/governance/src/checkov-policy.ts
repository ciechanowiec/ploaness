// The checkov checks this harness enables, and the reason each one is on the list.
//
// Specific validated rules at error severity, never a whole category. A category enables checks nobody
// read, and a rule count is not coverage - so each id here names a defect a governed project must not
// ship, with the reason it is refused written beside it.
//
// Every id was confirmed present in the PINNED image with `--list`. That check is not ceremony: a
// `--check` id that does not exist matches nothing and raises no error, so a typo would silently
// disable a rule while the run still passed. The digest pin is what keeps the audit durable, because
// the catalogue cannot change underneath it - which also means the audit is redone when the pin moves.
//
// Three checks were considered and deliberately left off. `CKV_AWS_133` (backup retention) and
// `CKV_AWS_139` / `CKV_AWS_293` (deletion protection on a cluster and on an instance) each state a
// POLICY about how an environment is run rather than a defect in how it is written: a deliberately
// ephemeral stage environment fails all three on its first day. Requiring them is defensible, but it is
// a decision to take on its own merits rather than one to smuggle in beside a set of defect checks.

/** One enabled check: the identifier checkov knows it by, and why this harness refuses what it finds. */
export interface CheckovCheck {
  readonly id: string
  readonly reason: string
}

/** The checks enabled at error severity, each confirmed present in the pinned image. */
export const CHECKOV_CHECKS: readonly CheckovCheck[] = [
  {
    id: 'CKV_AWS_274',
    reason:
      'a role, user or group carries AdministratorAccess, so one environment can destroy another',
  },
  {
    id: 'CKV_AWS_275',
    reason: 'the same administrator policy reached through a data source rather than an attachment',
  },
  {
    id: 'CKV_AWS_1',
    reason: 'a policy document grants every action on every resource',
  },
  {
    id: 'CKV_AWS_49',
    reason: 'a policy document names "*" as a statement action',
  },
  {
    id: 'CKV_AWS_62',
    reason: 'the same administrative grant written as an inline policy',
  },
  {
    id: 'CKV_AWS_63',
    reason: 'the same wildcard action written as an inline policy',
  },
  {
    id: 'CKV_AWS_41',
    reason: 'a long-lived access key is written into a provider block',
  },
  {
    id: 'CKV_AWS_17',
    reason: 'the database is reachable from the public internet',
  },
  {
    id: 'CKV_AWS_16',
    reason: 'the database instance stores its content unencrypted',
  },
  {
    id: 'CKV_AWS_96',
    reason: 'the database cluster stores its content unencrypted',
  },
  {
    id: 'CKV_AWS_20',
    reason: 'a bucket ACL grants public read, which serves unpublished media to anybody',
  },
  {
    id: 'CKV_AWS_57',
    reason: 'a bucket ACL grants public write, which is arbitrary upload to the site own origin',
  },
  {
    id: 'CKV_AWS_70',
    reason:
      'a bucket policy names any principal, which is the policy spelling of the same exposure',
  },
  {
    id: 'CKV_AWS_19',
    reason: 'the bucket stores uploads unencrypted',
  },
  {
    id: 'CKV_AWS_53',
    reason: 'the bucket does not block public ACLs',
  },
  {
    id: 'CKV_AWS_54',
    reason: 'the bucket does not block a public policy',
  },
  {
    id: 'CKV_AWS_55',
    reason: 'the bucket does not ignore public ACLs already set',
  },
  {
    id: 'CKV_AWS_56',
    reason: 'the bucket does not restrict public access at the account boundary',
  },
  {
    id: 'CKV_AWS_24',
    reason: 'a security group admits SSH from the whole internet',
  },
  {
    id: 'CKV_AWS_25',
    reason: 'a security group admits RDP from the whole internet',
  },
  {
    id: 'CKV_AWS_79',
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
