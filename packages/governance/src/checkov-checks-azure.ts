// The Azure checks this harness enables. Every id was confirmed present in the pinned image with
// `--list`, and every one was read at the pinned tag against the rubric in checkov-policy.ts, with the
// argument it inspects checked against the azurerm provider at 4.x and 5.x.
//
// Twenty-one of three hundred survive, and the reason is the provider's own history rather than the
// rubric's severity. A large family of checks reads only a pre-4.0 argument name
// (`enable_https_traffic_only`, `enable_non_ssl_port`, `enable_ip_forwarding`) and is blind to the
// current spelling. Another fails an ABSENT argument whose provider default is already the only
// accepted value: `min_tls_version` on a storage account, SQL server or Redis cache, `ftps_state` on
// a web app, `allow_nested_items_to_be_public` since 5.0. And some thirty-five bind only to resources
// the provider has removed - the single-server databases, `azurerm_app_service`,
// `azurerm_function_app`. Each of those would block a project for being right, or judge nothing.
//
// What survives reads an argument the current provider uses and fails only on an explicit insecure
// value, or on an absent one whose default is genuinely insecure - which is `https_only`, and only
// that. Graph checks here are single-resource attribute conditions with no connection clause, so a
// module boundary cannot manufacture a failure.
//
// Two firewall checks refuse the "allow Azure services" rule, `0.0.0.0` to `0.0.0.0`, which admits
// connections from every Azure tenant's subscriptions. For an App Service the repair is one rule per
// outbound address; for a consumption Container Apps environment without a virtual network there is
// no stable outbound address, and the repair is virtual-network integration - new resources, though
// free. That is the one place the rubric's "one argument" bends, and the guide says so.
//
// Not among the checks, because the analyzer has none: an `Owner` role assignment, plain-HTTP storage
// under the 4.x argument name, a Redis non-SSL port under its 4.x name, `require_secure_transport` on
// a flexible server, Front Door and Container Apps ingress. The pattern rules take the first three.
import type { CheckovCheck } from './checkov-check.js'

const azure = (id: string, reason: string): CheckovCheck => ({ id, provider: 'azurerm', reason })

/** The Azure checks enabled at error severity. */
export const AZURE_CHECKS: readonly CheckovCheck[] = [
  // Identity and registries.
  azure('CKV_AZURE_39', 'a custom role grants every action, which is an owner written by hand'),
  azure('CKV_AZURE_137', 'the container registry exposes a shared administrator credential'),
  azure('CKV_AZURE_138', 'the container registry serves images to unauthenticated pulls'),
  azure('CKV2_AZURE_30', 'the registry webhook posts to a plain-HTTP endpoint'),
  // Databases.
  azure('CKV_AZURE_11', 'a database firewall rule admits every IP address'),
  azure('CKV2_AZURE_26', 'the PostgreSQL server admits every Azure tenant, or every address'),
  azure('CKV2_AZURE_34', 'the SQL server admits every Azure tenant'),
  azure('CKV2_AZURE_25', 'the SQL database explicitly stores its content unencrypted'),
  // Storage.
  azure('CKV_AZURE_34', 'the blob container serves its blobs anonymously'),
  // Network.
  azure('CKV_AZURE_9', 'a network security rule admits RDP from the whole internet'),
  azure('CKV_AZURE_10', 'a network security rule admits SSH from the whole internet'),
  // Compute.
  azure('CKV_AZURE_149', 'the Linux virtual machine or scale set accepts password logins'),
  azure('CKV_AZURE_5', 'the Kubernetes cluster runs without role-based access control'),
  azure('CKV_AZURE_143', 'the Kubernetes nodes carry public IP addresses'),
  azure('CKV_AZURE_246', 'the retired, unauthenticated HTTP application routing add-on is on'),
  // Web.
  azure('CKV_AZURE_14', 'the web app serves plain HTTP, which is its default'),
  azure('CKV_AZURE_153', 'a deployment slot serves plain HTTP, which is its default'),
  azure('CKV_AZURE_70', 'the function app serves plain HTTP, which is its default'),
  azure('CKV_AZURE_15', 'the web app accepts TLS 1.0 or 1.1'),
  azure('CKV_AZURE_145', 'the function app accepts TLS 1.0 or 1.1'),
  azure('CKV_AZURE_72', 'the app exposes its remote-debugging endpoint'),
]
