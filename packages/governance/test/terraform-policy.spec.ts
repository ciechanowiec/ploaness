import { describe, expect, it } from 'vitest'
import { findTerraformViolations, type TerraformViolation } from '../src/terraform-policy.js'

const rulesOf = (source: string): readonly string[] =>
  findTerraformViolations(source).map((violation: TerraformViolation): string => violation.rule)

describe('no-force-destroy', () => {
  it('reports the argument switched on', () => {
    expect(rulesOf('resource "aws_s3_bucket" "media" {\n  force_destroy = true\n}')).toEqual([
      'no-force-destroy',
    ])
  })

  it('reports the quoted spelling terraform also accepts', () => {
    expect(rulesOf('  force_destroy = "true"')).toEqual(['no-force-destroy'])
  })

  // The repaired shape, which the whole rule exists to be switched off by.
  it('accepts the argument switched off', () => {
    expect(rulesOf('  force_destroy = false')).toEqual([])
  })

  // A variable is not a value this reader can resolve, and guessing would report a module that
  // supplies false everywhere it is used.
  it('accepts a value supplied by a variable', () => {
    expect(rulesOf('  force_destroy = var.force_destroy')).toEqual([])
  })

  it('accepts a line explaining why the argument is avoided', () => {
    expect(rulesOf('# force_destroy = true would delete the objects with the bucket')).toEqual([])
  })
})

describe('no-skipped-final-snapshot', () => {
  it('reports the argument switched on', () => {
    expect(rulesOf('  skip_final_snapshot = true')).toEqual(['no-skipped-final-snapshot'])
  })

  it('accepts the argument switched off', () => {
    expect(rulesOf('  skip_final_snapshot = false')).toEqual([])
  })
})

describe('no-placeholder-secret', () => {
  it.each(['"REPLACE-ME"', '"CHANGEME"', '"TODO"', '"<your-password>"'])(
    'reports a credential left as %s',
    (value: string) => {
      expect(rulesOf(`  db_password = ${value}`)).toEqual(['no-placeholder-secret'])
    },
  )

  it('names the attribute in the finding, so the repair is unambiguous', () => {
    const found: readonly TerraformViolation[] = findTerraformViolations(
      '  master_password = "REPLACE-ME"',
    )
    expect(found[0]?.reason).toContain('master_password')
  })

  // A reference is not a literal, and it is the shape a correct configuration takes.
  it('accepts a credential supplied from a variable', () => {
    expect(rulesOf('  db_password = var.db_password')).toEqual([])
  })

  it('accepts a credential that carries a real value', () => {
    expect(rulesOf('  db_password = "8f3c1d92aa47"')).toEqual([])
  })

  // An object key is a path rather than a credential, which is why bare `key` is out of scope.
  it('does not read an object key as a credential', () => {
    expect(rulesOf('  key = "uploads/logo.png"')).toEqual([])
  })

  // The argument a secret-store version actually holds its value in, which is where a real consumer's
  // placeholder sat. The credential word comes first here rather than last.
  it.each(['secret_string', 'secret_data', 'secret_binary'])(
    'reports a placeholder in %s, the content of a stored secret',
    (attribute: string) => {
      expect(rulesOf(`  ${attribute} = "REPLACE-ME"`)).toEqual(['no-placeholder-secret'])
    },
  )

  // These name a secret rather than hold one; a placeholder there guards nothing.
  it.each(['secret_id', 'secret_arn', 'secret_name'])(
    'does not read %s as a credential',
    (attribute: string) => {
      expect(rulesOf(`  ${attribute} = "REPLACE-ME"`)).toEqual([])
    },
  )
})

const ingressRule = (attributes: string): string =>
  `resource "aws_vpc_security_group_ingress_rule" "web" {\n  security_group_id = "sg-1"\n${attributes}\n}\n`

describe('no-open-ingress', () => {
  // The idiomatic spelling of "everything from everywhere" in the rule resource the provider
  // recommends, which the analyzer's own check does not read.
  it('reports every protocol from every address', () => {
    expect(rulesOf(ingressRule('  cidr_ipv4   = "0.0.0.0/0"\n  ip_protocol = "-1"'))).toEqual([
      'no-open-ingress',
    ])
  })

  it('reports every port from every address', () => {
    expect(
      rulesOf(
        ingressRule(
          '  cidr_ipv4   = "0.0.0.0/0"\n  ip_protocol = "tcp"\n  from_port   = 0\n  to_port     = 65535',
        ),
      ),
    ).toEqual(['no-open-ingress'])
  })

  it('reports SSH from every address, and says so', () => {
    const found: readonly TerraformViolation[] = findTerraformViolations(
      ingressRule(
        '  cidr_ipv4   = "0.0.0.0/0"\n  ip_protocol = "tcp"\n  from_port   = 22\n  to_port     = 22',
      ),
    )
    expect(found[0]?.reason).toContain('SSH')
  })

  it('reports the IPv6 spelling of every address', () => {
    expect(rulesOf(ingressRule('  cidr_ipv6   = "::/0"\n  ip_protocol = "-1"'))).toEqual([
      'no-open-ingress',
    ])
  })

  // The ports a public site opens to the world.
  it('accepts HTTPS from every address', () => {
    expect(
      rulesOf(
        ingressRule(
          '  cidr_ipv4   = "0.0.0.0/0"\n  ip_protocol = "tcp"\n  from_port   = 443\n  to_port     = 443',
        ),
      ),
    ).toEqual([])
  })

  // The correct form the analyzer's SSH check refused: the source is another group, not an address.
  it('accepts SSH from another security group', () => {
    expect(
      rulesOf(
        ingressRule(
          '  referenced_security_group_id = "sg-bastion"\n  ip_protocol = "tcp"\n  from_port = 22\n  to_port = 22',
        ),
      ),
    ).toEqual([])
  })

  it('accepts the same attributes on an egress rule, whose type names its direction', () => {
    const egress: string =
      'resource "aws_vpc_security_group_egress_rule" "all" {\n  cidr_ipv4   = "0.0.0.0/0"\n  ip_protocol = "-1"\n}\n'
    expect(rulesOf(egress)).toEqual([])
  })

  // The span ends at the next top-level block, so a following egress rule cannot lend its address.
  it('does not read a following block into an ingress rule', () => {
    const two: string =
      'resource "aws_vpc_security_group_ingress_rule" "web" {\n  referenced_security_group_id = "sg-alb"\n  ip_protocol = "-1"\n}\n' +
      'resource "aws_vpc_security_group_egress_rule" "all" {\n  cidr_ipv4   = "0.0.0.0/0"\n  ip_protocol = "-1"\n}\n'
    expect(rulesOf(two)).toEqual([])
  })
})

describe('no-analyzer-suppression', () => {
  it.each([
    '#checkov:skip=CKV_AWS_274:temporary',
    '# checkov:skip=CKV_AWS_20',
    '#tfsec:ignore:aws-s3',
  ])('reports %s, which turns an enabled check off', (comment: string) => {
    expect(rulesOf(comment)).toEqual(['no-analyzer-suppression'])
  })

  it('accepts an ordinary comment', () => {
    expect(rulesOf('# the bucket is private and fronted by the distribution')).toEqual([])
  })
})

describe('what findTerraformViolations deliberately leaves alone', () => {
  // The guard the whole `0.0.0.0/0` decision rests on: the same address is correct on egress, and no
  // rule here reads it at all.
  it('says nothing about an open egress rule', () => {
    const source: string = [
      'resource "aws_security_group" "tasks" {',
      '  egress {',
      '    cidr_blocks = ["0.0.0.0/0"]',
      '  }',
      '}',
    ].join('\n')
    expect(rulesOf(source)).toEqual([])
  })

  // Owned by a curated checkov check, where the resource graph is understood rather than guessed at.
  it('says nothing about an administrator policy, which the analyzer owns', () => {
    expect(rulesOf('  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"')).toEqual([])
  })

  it('finds nothing in a configuration that carries none of these defects', () => {
    const source: string = [
      'resource "aws_db_instance" "main" {',
      '  storage_encrypted   = true',
      '  skip_final_snapshot = false',
      '  password            = var.db_password',
      '}',
    ].join('\n')
    expect(rulesOf(source)).toEqual([])
  })
})

describe('the order findings are reported in', () => {
  it('reports them by the line they sit on rather than by rule', () => {
    const source: string = [
      '  db_password = "REPLACE-ME"',
      '  force_destroy = true',
      '#checkov:skip=CKV_AWS_20',
    ].join('\n')
    const lines: readonly number[] = findTerraformViolations(source).map(
      (violation: TerraformViolation): number => violation.line,
    )
    expect(lines).toEqual([1, 2, 3])
  })
})
