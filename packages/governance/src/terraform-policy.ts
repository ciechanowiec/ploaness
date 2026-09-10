// Infrastructure defects a text reader can decide on its own, and only those.
//
// Every rule here owns a question the analyzer beside it does not answer. Where checkov has a check,
// checkov keeps it: one semantic rule has one owner, and a second opinion written as a regular
// expression would be the weaker of the two. So `AdministratorAccess`, wildcard IAM actions and a
// publicly reachable database are absent from this file deliberately - they are enabled as curated
// checks instead, where the resource graph is understood rather than guessed at from one line.
//
// `0.0.0.0/0` is read in exactly one place: the standalone ingress rule resource, whose TYPE names its
// direction. Everywhere else text cannot decide it. The same address is correct on egress and fatal on
// ingress, and an `ingress` block or an `aws_security_group_rule` carries its direction in a nested
// block or a sibling attribute that a line reader cannot tie to the address - so those forms stay
// with the analyzer, which knows which side of the rule it is looking at. The standalone resource is
// this file's because the analyzer does not read its idiomatic spelling at all, and its own SSH and RDP
// checks read a rule naming another security group as its source as open to the world.
import { stripComments } from './source-text.js'

/** An infrastructure defect found in a project's own configuration. */
export interface TerraformViolation {
  readonly line: number
  readonly rule: string
  readonly reason: string
}

const FIRST_LINE: number = 1

// An argument assigned `true`, bare or quoted, on its own line. Terraform accepts both spellings.
const assignedTrue = (attribute: string): RegExp =>
  new RegExp(String.raw`^[ \t]*${attribute}[ \t]*=[ \t]*"?true"?`)

/** One argument that destroys data by being switched on. */
interface FlagRule {
  readonly pattern: RegExp
  readonly rule: string
  readonly reason: string
}

// Both arguments exist only where they destroy data, and checkov ships no check for either - which is
// what makes them this file's business rather than the analyzer's. The patterns are built once here
// rather than per line, so the scan is one pass over the text.
const FLAG_RULES: readonly FlagRule[] = [
  {
    pattern: assignedTrue('force_destroy'),
    rule: 'no-force-destroy',
    reason:
      'force_destroy lets a destroy remove a bucket or repository that still holds objects, so a ' +
      'replacement-forcing edit deletes the data rather than failing - remove it, and empty the ' +
      'store deliberately when it is genuinely meant to go',
  },
  {
    pattern: assignedTrue('skip_final_snapshot'),
    rule: 'no-skipped-final-snapshot',
    reason:
      'skip_final_snapshot leaves a deleted database with nothing to restore from, and a destroy ' +
      'that was never meant to reach production is exactly when that snapshot is wanted - remove it ' +
      'and let the final snapshot be taken',
  },
]

// A quoted assignment, whatever it names. WHICH names hold a credential is decided below rather than
// inside the pattern: one alternation covering every spelling was unreadable and past the complexity
// the lint budget allows, and it is the name's segments that carry the meaning anyway.
const QUOTED_ASSIGNMENT: RegExp = /^[ \t]*(?<name>\w+)[ \t]*=[ \t]*"(?<value>[^"]*)"/

// Read by the last `_`-segment of the name, the way the credential guard in `source-security.ts` reads
// an identifier. `key` alone is excluded: an S3 object's `key` is a path, and reading it as a
// credential would report every upload in the tree - so only a QUALIFIED key counts.
const CREDENTIAL_WORDS: ReadonlySet<string> = new Set([
  'password',
  'passphrase',
  'secret',
  'token',
  'credential',
  'credentials',
])

const QUALIFIED_KEYS: ReadonlySet<string> = new Set([
  'api',
  'access',
  'secret',
  'private',
  'encryption',
])

// A secret's CONTENT argument is named the other way round: `secret_string`, `secret_data` and
// `secret_binary` are what a secret-store version holds, so the first segment carries the meaning and
// the last says what shape the content takes. `secret_id` and `secret_arn` name a secret rather than
// hold one, and stay outside.
const SECRET_CONTENT: ReadonlySet<string> = new Set(['string', 'data', 'binary', 'value'])

const PENULTIMATE: number = -2

const isCredentialName = (name: string): boolean => {
  const segments: readonly string[] = name.toLowerCase().split('_')
  const first: string = segments.at(0) ?? ''
  const last: string = segments.at(-1) ?? ''
  if (last === 'key') {
    return QUALIFIED_KEYS.has(segments.at(PENULTIMATE) ?? '')
  }
  return CREDENTIAL_WORDS.has(last) || (first === 'secret' && SECRET_CONTENT.has(last))
}

// What a placeholder looks like once punctuation and case stop mattering. An angle-bracketed value is
// the other conventional spelling, and it needs no vocabulary.
const PLACEHOLDER_VALUES: ReadonlySet<string> = new Set([
  'REPLACEME',
  'CHANGEME',
  'TODO',
  'FIXME',
  'XXX',
  'PLACEHOLDER',
  'TBD',
  'YOURVALUEHERE',
])

const isPlaceholder = (value: string): boolean => {
  if (value.startsWith('<') && value.endsWith('>')) {
    return true
  }
  return PLACEHOLDER_VALUES.has(value.toUpperCase().replaceAll(/[^A-Z0-9]/g, ''))
}

// An analyzer's own inline skip. Without this the curated checks are advisory: one comment turns the
// flagship check off and the run still passes. gitleaks cannot see a placeholder either - it carries no
// entropy - which is why the value rule above is here rather than left to the secret scan.
const ANALYZER_SUPPRESSION: RegExp = /#[ \t]*(?<analyzer>checkov:skip=|tfsec:ignore:|trivy:ignore:)/

const flagViolations = (code: string): readonly TerraformViolation[] =>
  code.split('\n').flatMap((line: string, index: number): readonly TerraformViolation[] =>
    FLAG_RULES.filter((flag: FlagRule): boolean => flag.pattern.test(line)).map(
      (flag: FlagRule): TerraformViolation => ({
        line: index + FIRST_LINE,
        rule: flag.rule,
        reason: flag.reason,
      }),
    ),
  )

// The attribute a line leaves as a placeholder, or nothing. Separated from the walk below so each reads
// as the one question it asks.
const placeholderNameIn = (line: string): string | undefined => {
  const found: RegExpExecArray | null = QUOTED_ASSIGNMENT.exec(line)
  if (found === null) {
    return undefined
  }
  const name: string = found.groups?.['name'] ?? ''
  const value: string = found.groups?.['value'] ?? ''
  return isCredentialName(name) && isPlaceholder(value) ? name : undefined
}

const placeholderViolations = (code: string): readonly TerraformViolation[] =>
  code.split('\n').flatMap((line: string, index: number): readonly TerraformViolation[] => {
    const name: string | undefined = placeholderNameIn(line)
    return name === undefined
      ? []
      : [
          {
            line: index + FIRST_LINE,
            rule: 'no-placeholder-secret',
            reason:
              `${name} is set to a placeholder, so whatever it guards is guarded by a value written ` +
              'into the repository - supply it from a secret store, and let the configuration name ' +
              'the reference rather than the value',
          },
        ]
  })

// Read from the RAW text, unlike every rule above: a comment is this rule's subject rather than
// something to see past.
const suppressionViolations = (source: string): readonly TerraformViolation[] =>
  source.split('\n').flatMap((line: string, index: number): readonly TerraformViolation[] => {
    const analyzer: string | undefined = ANALYZER_SUPPRESSION.exec(line)?.groups?.['analyzer']
    return analyzer === undefined
      ? []
      : [
          {
            line: index + FIRST_LINE,
            rule: 'no-analyzer-suppression',
            reason:
              `"${analyzer}" turns off a check this harness enabled, from inside the file the check ` +
              'judges - repair what the analyzer found, because a gate a project can switch off is ' +
              'not a gate',
          },
        ]
  })

// The rule resource is read from its header to the next line that closes or opens a top-level block.
// Formatted HCL closes a resource at column 0; unformatted HCL over-reads at worst the blank lines
// before the next block, never the next block's attributes.
const INGRESS_RULE_HEADER: RegExp = /^[ \t]*resource[ \t]+"aws_vpc_security_group_ingress_rule"/
const BLOCK_BOUNDARY: RegExp =
  /^(?:\}|(?:resource|data|module|variable|output|locals|provider|terraform)\b)/
const ANY_ADDRESS: RegExp = /^[ \t]*cidr_ipv[46][ \t]*=[ \t]*"(?:0\.0\.0\.0\/0|::\/0)"/
const EVERY_PROTOCOL: RegExp = /^[ \t]*ip_protocol[ \t]*=[ \t]*"?-1"?/
const PORT_EDGE: RegExp = /^[ \t]*(?<edge>from_port|to_port)[ \t]*=[ \t]*(?<port>\d+)/

const SSH_PORT: number = 22
const RDP_PORT: number = 3389
const LAST_PORT: number = 65_535

interface IngressRule {
  readonly line: number
  readonly body: readonly string[]
}

interface PortRange {
  readonly from: number
  readonly to: number
}

const ingressRulesIn = (lines: readonly string[]): readonly IngressRule[] =>
  lines.flatMap((line: string, index: number): readonly IngressRule[] => {
    if (!INGRESS_RULE_HEADER.test(line)) {
      return []
    }
    const rest: readonly string[] = lines.slice(index + 1)
    const end: number = rest.findIndex((candidate: string): boolean =>
      BLOCK_BOUNDARY.test(candidate),
    )
    return [{ line: index + FIRST_LINE, body: end === -1 ? rest : rest.slice(0, end) }]
  })

const portRangeOf = (body: readonly string[]): PortRange | undefined => {
  const edges: ReadonlyMap<string, number> = new Map(
    body.flatMap((line: string): readonly (readonly [string, number])[] => {
      const found: RegExpExecArray | null = PORT_EDGE.exec(line)
      return found === null
        ? []
        : [[found.groups?.['edge'] ?? '', Number(found.groups?.['port'] ?? '')]]
    }),
  )
  const from: number | undefined = edges.get('from_port')
  const to: number | undefined = edges.get('to_port')
  return from === undefined || to === undefined ? undefined : { from, to }
}

const coversPort = (range: PortRange, port: number): boolean =>
  range.from <= port && port <= range.to

// What a port range exposes when its source is every address, or nothing when its ports are ones a
// public site legitimately opens.
const exposureOfRange = (range: PortRange): string | undefined => {
  if (range.from === 0 && range.to === LAST_PORT) {
    return 'every port'
  }
  if (coversPort(range, SSH_PORT)) {
    return 'SSH'
  }
  return coversPort(range, RDP_PORT) ? 'RDP' : undefined
}

const exposureOf = (body: readonly string[]): string | undefined => {
  if (!body.some((line: string): boolean => ANY_ADDRESS.test(line))) {
    return undefined
  }
  if (body.some((line: string): boolean => EVERY_PROTOCOL.test(line))) {
    return 'every port'
  }
  const range: PortRange | undefined = portRangeOf(body)
  return range === undefined ? undefined : exposureOfRange(range)
}

const openIngressViolations = (code: string): readonly TerraformViolation[] =>
  ingressRulesIn(code.split('\n')).flatMap((rule: IngressRule): readonly TerraformViolation[] => {
    const exposure: string | undefined = exposureOf(rule.body)
    return exposure === undefined
      ? []
      : [
          {
            line: rule.line,
            rule: 'no-open-ingress',
            reason:
              `an ingress rule admits ${exposure} from the whole internet - name the security ` +
              'group or address range that needs it as the source',
          },
        ]
  })

/**
 * Report every infrastructure defect a text reader can decide.
 * @param source the file's text, as tracked.
 * @returns one violation per defect, ordered by the line it sits on.
 */
export const findTerraformViolations = (source: string): readonly TerraformViolation[] => {
  // `stripComments` covers the `//` and `/* */` forms HCL shares with the languages it was written
  // for. It does NOT read `#`, which is HCL's own spelling - what keeps `# force_destroy = true` out
  // of the value rules is that each pattern is anchored at the attribute, so a leading `#` cannot
  // match. The suppression rule reads the raw text instead, because the comment is its subject.
  const code: string = stripComments(source)
  return [
    ...flagViolations(code),
    ...placeholderViolations(code),
    ...openIngressViolations(code),
    ...suppressionViolations(source),
  ].toSorted(
    (left: TerraformViolation, right: TerraformViolation): number => left.line - right.line,
  )
}
