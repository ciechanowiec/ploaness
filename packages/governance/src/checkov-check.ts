// The shape of one enabled checkov check, declared apart from the tables that list them and the policy
// that reads them so that neither imports the other.

/** A provider this harness has curated checks for. Widened as each cloud's audit lands. */
export type CuratedProviderName = 'aws'

/** One enabled check: the identifier checkov knows it by, its provider, and why the finding is refused. */
export interface CheckovCheck {
  readonly id: string
  readonly provider: CuratedProviderName
  readonly reason: string
}
