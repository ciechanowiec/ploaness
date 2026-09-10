// The Google Cloud checks this harness enables, with the handful the pinned image ships for
// DigitalOcean and Linode. Every id was confirmed present with `--list`, and every one was read at the
// pinned tag against the rubric in checkov-policy.ts. Two mechanics decide most of what follows: a
// value check FAILS when its argument is absent, a negative-value check PASSES when it is.
//
// Three checks the audit proposed were left off on re-reading, each for failing a correct
// configuration. `CKV_GCP_60` refuses a Cloud SQL public address, but `ipv4_enabled = false` is
// rejected by the API without private services access and Cloud Run then needs VPC egress - not one
// argument, and Google's own Cloud Run path is a public address with an empty authorised list, which
// `CKV_GCP_11` tells apart from the defect. `CKV_GCP_20` requires an authorised-networks block, so a
// private-endpoint cluster with no public endpoint fails; `CKV_GCP_18` is the deterministic half.
// `CKV_GCP_33` accepts only the exact string "TRUE" for OS Login, so an unquoted `true` fails.
//
// Left off by rubric where the provider has moved on: `CKV_GCP_6` reads `ssl_mode` but accepts only
// `TRUSTED_CLIENT_CERTIFICATE_REQUIRED` for PostgreSQL, rejecting `ENCRYPTED_ONLY`, the correct
// setting for a client without a certificate - the pattern rules refuse the explicit plaintext value
// instead. `CKV_GCP_24` reads an argument that never existed in the GA provider and fails every
// cluster; `CKV_GCP_69` fails Autopilot; `CKV2_GCP_7` ignores the write-only `password_wo`. The public
// Cloud Run invoker checks (`102`, `113`) refuse how a public site is served, and the project-role
// checks (`44`, `45`, `49`, `115`-`117`) all also flag `viewer` or documented deploy roles - which is
// why `roles/owner` and `roles/editor` are the pattern rules' business too.
//
// Known limits, stated in the guide: the firewall checks read the literal `0.0.0.0/0` and miss `::/0`
// and an absent `source_ranges`, which Google defaults to every address; and `CKV_GCP_28`, `29` and
// `114` refuse serving media straight from a public bucket, the same stance the AWS list takes.
//
// DigitalOcean's firewall check fails on `0.0.0.0/0` regardless of port, so a web droplet's 443 fails
// it; Linode's outbound policy check demands default-deny egress. Both are left off.
import type { CheckovCheck } from './checkov-check.js'

const google = (id: string, reason: string): CheckovCheck => ({ id, provider: 'google', reason })

/** The Google Cloud checks enabled at error severity. */
export const GOOGLE_CHECKS: readonly CheckovCheck[] = [
  // Identity and keys.
  google('CKV_GCP_41', 'a principal may act as every service account in the project'),
  google('CKV_GCP_31', 'the virtual machine runs as the default compute account with every API'),
  google('CKV_GCP_112', 'the KMS key can be used by anybody'),
  google('CKV2_GCP_8', 'the whole key ring can be used by anybody'),
  // Databases and caches.
  google('CKV_GCP_11', 'the Cloud SQL instance admits every address on the internet'),
  google('CKV_GCP_95', 'the Redis instance accepts unauthenticated connections'),
  // Storage.
  google('CKV_GCP_28', 'the bucket is readable or writable by anybody'),
  google('CKV_GCP_29', 'the bucket honours per-object ACLs, so one object can be made public'),
  google('CKV_GCP_114', 'the bucket can be made public by any later grant'),
  // Network.
  google('CKV_GCP_2', 'a firewall admits SSH from the whole internet'),
  google('CKV_GCP_3', 'a firewall admits RDP from the whole internet'),
  google('CKV_GCP_88', 'a firewall admits MySQL from the whole internet'),
  google('CKV_GCP_75', 'a firewall admits FTP control from the whole internet'),
  google('CKV_GCP_77', 'a firewall admits FTP data from the whole internet'),
  google('CKV2_GCP_12', 'a firewall admits every port and protocol from the whole internet'),
  google('CKV_GCP_27', 'the project gets the default network and its allow-from-anywhere rules'),
  // Compute.
  google('CKV_GCP_7', 'the cluster honours legacy ABAC, which bypasses RBAC'),
  google('CKV_GCP_18', "the control plane's authorised network list is the whole internet"),
  google('CKV_GCP_34', 'the virtual machine opts out of OS Login'),
  google('CKV_GCP_35', 'the virtual machine exposes an interactive serial console'),
  google('CKV2_GCP_10', 'the HTTP-triggered function answers plaintext HTTP'),
  // The edge.
  google('CKV_GCP_4', 'the TLS policy admits TLS 1.0 or 1.1, or a non-forward-secret cipher suite'),
  google('CKV_GCP_17', 'DNSSEC signs the zone with RSASHA1'),
  // Other services a project may reach for.
  google('CKV_GCP_99', 'the topic can be published to or read by anybody'),
  google('CKV_GCP_100', 'the table can be read by anybody'),
  google('CKV_GCP_101', 'the image repository can be pulled by anybody'),
  google('CKV_GCP_98', 'the cluster can be driven by anybody'),
]

/** The DigitalOcean and Linode checks enabled at error severity: the pinned image ships ten in all. */
export const SMALL_CLOUD_CHECKS: readonly CheckovCheck[] = [
  { id: 'CKV_DIO_3', provider: 'digitalocean', reason: 'the Spaces bucket is world-readable' },
  {
    id: 'CKV_LIN_1',
    provider: 'linode',
    reason: 'a Linode API token is written into the provider block',
  },
  {
    id: 'CKV_LIN_5',
    provider: 'linode',
    reason: "the firewall's default inbound action is allow, so every port not listed is open",
  },
]
