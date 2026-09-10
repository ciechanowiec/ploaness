// The shape of one enabled checkov check, declared apart from the tables that list them and the policy
// that reads them so that neither imports the other.

/** A provider this harness has curated checks for, named as its resource types spell it. */
export type CuratedProviderName = 'aws' | 'azurerm' | 'google' | 'digitalocean' | 'linode'

/** One enabled check: the identifier checkov knows it by, its provider, and why the finding is refused. */
export interface CheckovCheck {
  readonly id: string
  readonly provider: CuratedProviderName
  readonly reason: string
}
