// Infrastructure defects a text reader can decide on its own, and only those.
//
// Every rule here owns a question the analyzer beside it does not answer. Where checkov has a check,
// checkov keeps it: one semantic rule has one owner, and a second opinion written as a regular
// expression would be the weaker of the two. So `AdministratorAccess`, wildcard IAM actions and a
// publicly reachable database are absent from this file deliberately - they are enabled as curated
// checks instead, where the resource graph is understood rather than guessed at from one line.
//
// `0.0.0.0/0` is absent for a stronger reason: text cannot decide it. The same address is correct on
// egress and fatal on ingress, and modern HCL spells ingress three ways - an `ingress` block, an
// `aws_security_group_rule` with `type = "ingress"`, and `aws_vpc_security_group_ingress_rule` - plus
// `dynamic` blocks and rules whose CIDR arrives in a variable. A reader handling the first form and
// missing the rest would pass a project it had not read; one matching the address anywhere would report
// nearly every conforming module for its egress. The curated checks cover the two cases that are never
// legitimate, SSH and RDP, using a tool that knows which side of the rule it is looking at.
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

const PENULTIMATE: number = -2

const isCredentialName = (name: string): boolean => {
  const segments: readonly string[] = name.toLowerCase().split('_')
  const last: string = segments.at(-1) ?? ''
  return last === 'key'
    ? QUALIFIED_KEYS.has(segments.at(PENULTIMATE) ?? '')
    : CREDENTIAL_WORDS.has(last)
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
    ...suppressionViolations(source),
  ].toSorted(
    (left: TerraformViolation, right: TerraformViolation): number => left.line - right.line,
  )
}
