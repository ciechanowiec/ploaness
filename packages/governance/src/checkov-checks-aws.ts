// The AWS checks this harness enables. Every id was confirmed present in the pinned image with
// `--list`, and every one was read at the pinned tag against the rubric in checkov-policy.ts.
//
// Left off after failing a correct configuration in a fixture against the pinned image, rather than
// after reading alone:
// - `CKV_AWS_24` / `CKV_AWS_25` (SSH and RDP from the internet) treat an
//   `aws_vpc_security_group_ingress_rule` that references another security group as unrestricted
//   whenever its port range covers 22 or 3389: "SSH from the bastion's group" and "every TCP port from
//   the load balancer's group" both fail. That is the resource type the provider recommends, so the
//   two would block the correct form. `CKV_AWS_277` shares their base class and does not have the
//   defect, so every port from the whole internet is still refused.
// - `CKV_AWS_358` / `CKV_AWS_393` (GitHub OIDC trust) passed a trust policy admitting every repository
//   in an organisation, the case that matters, and were not shown to refuse anything a fixture wrote.
// - `CKV_AWS_206` fails an API Gateway domain that leaves `security_policy` absent, which on a regional
//   endpoint already means TLS 1.2.
//
// Left off by rubric: `CKV_AWS_2` and `CKV_AWS_103` fail a load balancer whose only listener forwards
// plain HTTP, the CloudFront-to-origin pattern, and passing them needs a certificate and a custom
// origin hostname rather than an argument (R3) - a plain-HTTP load balancer with nothing in front of
// it is therefore not caught, and the guide says so. `CKV_AWS_60` ignores the condition on a wildcard
// trust principal, so the documented `aws:PrincipalOrgID` form fails. `CKV_AWS_27`, `81`, `77` and
// `159` fail an absent encryption argument on services that encrypt by default. The policy tranche
// (`133`, `139`, `293` and the logging, versioning and hardening families) states how an environment
// is run rather than a defect in how it is written.
import type { CheckovCheck } from './checkov-check.js'

const aws = (id: string, reason: string): CheckovCheck => ({ id, provider: 'aws', reason })

/** The AWS checks enabled at error severity. */
export const AWS_CHECKS: readonly CheckovCheck[] = [
  // Identity and access.
  aws(
    'CKV_AWS_274',
    'a role, user or group carries AdministratorAccess, so one environment can destroy another',
  ),
  aws(
    'CKV_AWS_275',
    'the same administrator policy reached through a data source rather than an attachment',
  ),
  aws('CKV_AWS_1', 'a policy document grants every action on every resource'),
  aws('CKV_AWS_49', 'a policy document names "*" as a statement action'),
  aws('CKV_AWS_62', 'the same administrative grant written as an inline policy'),
  aws('CKV_AWS_63', 'the same wildcard action written as an inline policy'),
  aws(
    'CKV2_AWS_40',
    'a policy grants every IAM action, which is administrator access under another name',
  ),
  aws('CKV2_AWS_56', 'a principal carries IAMFullAccess'),
  aws('CKV_AWS_283', 'a resource policy grants an action to every principal with no condition'),
  aws('CKV_AWS_41', 'a long-lived access key is written into a provider block'),
  aws('CKV_AWS_348', 'an access key is minted for the root user'),
  aws(
    'CKV_AWS_364',
    'a service principal may invoke the function from any account, with no source ARN or account',
  ),
  aws('CKV_AWS_33', 'a key policy grants a wildcard principal with no condition'),
  // Databases, caches and search.
  aws('CKV_AWS_17', 'the database is reachable from the public internet'),
  aws('CKV_AWS_16', 'the database instance stores its content unencrypted'),
  aws('CKV_AWS_96', 'the database cluster stores its content unencrypted'),
  aws('CKV_AWS_140', 'the global database cluster stores its content unencrypted'),
  aws('CKV_AWS_211', 'the database pins a retired certificate authority bundle'),
  aws('CKV_AWS_302', 'a database snapshot is shared with every AWS account'),
  aws('CKV_AWS_74', 'the document database stores its content unencrypted'),
  aws('CKV_AWS_90', 'the document database explicitly disables TLS'),
  aws('CKV_AWS_44', 'the graph database stores its content unencrypted'),
  aws('CKV_AWS_102', 'the graph database is reachable from the public internet'),
  aws('CKV_AWS_64', 'the warehouse stores its content unencrypted'),
  aws('CKV_AWS_87', 'the warehouse is reachable from the public internet, which is its default'),
  aws('CKV_AWS_29', 'the cache stores its content unencrypted'),
  aws('CKV_AWS_30', 'the cache accepts plaintext connections'),
  aws('CKV_AWS_202', 'the in-memory database explicitly disables TLS'),
  aws('CKV_AWS_47', 'the DynamoDB accelerator stores its content unencrypted'),
  aws('CKV_AWS_239', 'the DynamoDB accelerator endpoint is plaintext'),
  aws('CKV_AWS_5', 'the search domain stores its content unencrypted'),
  aws('CKV_AWS_6', 'a multi-node search domain moves data between nodes in plaintext'),
  aws('CKV_AWS_83', 'the search domain explicitly allows plain HTTP'),
  aws('CKV_AWS_228', 'the search endpoint accepts TLS below 1.2, which is its default policy'),
  aws('CKV_AWS_89', 'the migration instance is reachable from the public internet'),
  aws('CKV2_AWS_49', 'a migration endpoint explicitly sets its SSL mode to none'),
  // Storage.
  aws('CKV_AWS_20', 'a bucket ACL grants public read, which serves unpublished media to anybody'),
  aws(
    'CKV_AWS_57',
    'a bucket ACL grants public write, which is arbitrary upload to the site own origin',
  ),
  aws(
    'CKV_AWS_70',
    'a bucket policy names any principal, which is the policy spelling of the same exposure',
  ),
  aws('CKV_AWS_375', 'a bucket ACL grant gives full control or ACL reads to every user'),
  aws('CKV2_AWS_43', 'a bucket ACL grant targets every authenticated AWS user'),
  aws('CKV_AWS_19', 'the bucket stores uploads unencrypted'),
  aws('CKV_AWS_53', 'the bucket does not block public ACLs'),
  aws('CKV_AWS_54', 'the bucket does not block a public policy'),
  aws('CKV_AWS_55', 'the bucket does not ignore public ACLs already set'),
  aws('CKV_AWS_56', 'the bucket does not restrict public access at the account boundary'),
  aws('CKV_AWS_392', 'an access point disables all four public-access blocks'),
  aws('CKV_AWS_3', 'a volume stores its content unencrypted'),
  aws('CKV_AWS_8', 'an instance root device stores its content unencrypted'),
  aws('CKV_AWS_106', 'account default volume encryption is explicitly switched off'),
  aws('CKV_AWS_42', 'the file system stores its content unencrypted'),
  aws('CKV_AWS_97', 'a task mounts the file system without transit encryption'),
  aws('CKV_AWS_204', 'an image block device is unencrypted'),
  aws('CKV_AWS_235', 'an image copy is unencrypted'),
  // Network.
  aws('CKV_AWS_277', 'a security group admits every port from the whole internet'),
  aws(
    'CKV_AWS_100',
    'a node group sets an SSH key with no source security group, which AWS opens to the world',
  ),
  aws(
    'CKV_AWS_79',
    'instance metadata v1 is enabled, so any request forgery becomes credential theft',
  ),
  aws('CKV_AWS_371', 'the notebook instance allows instance metadata v1'),
  // Compute and build.
  aws('CKV_AWS_210', 'a batch container runs privileged'),
  aws('CKV_AWS_78', 'build artifact encryption is explicitly disabled'),
  aws(
    'CKV_AWS_386',
    'an image lookup names no owner and a wildcard name, which is the substitution attack',
  ),
  aws('CKV_AWS_390', 'the cluster block on public access is switched off'),
  // The edge.
  aws('CKV_AWS_328', 'the load balancer runs request-desync mitigation in monitor mode only'),
  aws('CKV_AWS_34', 'a cache behaviour serves the site over plain HTTP as well as HTTPS'),
  aws('CKV2_AWS_54', 'an origin lists SSLv3 among its protocols'),
  aws('CKV_AWS_308', 'a stage caches responses unencrypted'),
  // Messaging.
  aws('CKV_AWS_168', 'the queue policy is reachable from the internet'),
  aws('CKV_AWS_169', 'the topic policy is reachable from the internet'),
  aws('CKV_AWS_43', 'the stream stores records unencrypted'),
  aws('CKV_AWS_240', 'the delivery stream stores records unencrypted'),
  aws('CKV_AWS_291', 'the message brokers carry public IP addresses'),
  aws('CKV_AWS_69', 'the message broker is reachable from the public internet'),
  // Other services a project may reach for.
  aws('CKV_AWS_32', 'the container registry policy is reachable from the internet'),
  aws('CKV_AWS_167', 'the vault access policy is reachable from the internet'),
  aws('CKV_AWS_303', 'a systems manager document is shared with every AWS account'),
  aws('CKV_AWS_357', 'the transfer server enables plaintext FTP'),
  aws('CKV_AWS_214', 'the API cache stores responses unencrypted'),
  aws('CKV_AWS_215', 'the API cache moves responses in plaintext'),
  aws('CKV_AWS_218', 'the search endpoint accepts TLS 1.0'),
  aws('CKV_AWS_220', 'the search endpoint allows plain HTTP'),
]
