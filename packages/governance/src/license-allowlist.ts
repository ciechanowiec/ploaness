import { escapeForRegex } from './text-escapes.js'

// License allowlist policy for dependencies. The pure logic - the allowlist and the SPDX-expression
// evaluator - lives here so it is unit-tested; the `licenses` gate in
// packages/cli/src/checks/dependencies.ts shells out to pnpm and reports.

// The two groups are arrays rather than sets so the allowlist can be assembled with a single
// constructor call. Merging two sets would want `Set.prototype.union`, which the ES2023 lib target does
// not carry, and a lint fix that reaches for it produces code that does not compile.

// Permissive licenses: no copyleft obligations, safe for an MIT-licensed template.
const PERMISSIVE: readonly string[] = [
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT-0',
  'Python-2.0',
  'Unlicense',
  'WTFPL',
]

// Weak copyleft, permitted only as UNMODIFIED dependencies: the file-level (MPL) and dynamic-linking
// (LGPL) copyleft does not reach this project's own source. Each id is listed explicitly so it stays
// a conscious decision. Strong copyleft (GPL, AGPL) is deliberately absent and therefore rejected.
const WEAK_COPYLEFT: readonly string[] = ['LGPL-3.0-only', 'LGPL-3.0-or-later', 'MPL-2.0']

const ALLOWED: ReadonlySet<string> = new Set<string>([...PERMISSIVE, ...WEAK_COPYLEFT])

// SPDX ids are case-insensitive in the registries that emit them, and `Apache-2.0` arrives spelled at
// least three ways. The allowlist is matched on a folded id so a casing difference is not a licence
// decision. A `WITH` exception (`GPL-2.0 WITH Classpath-exception-2.0`) names the same licence plus a
// grant, so the licence half decides; a `+` suffix means "or later", which is the same licence too.
const ALLOWED_FOLDED: ReadonlySet<string> = new Set(
  [...ALLOWED].map((id: string): string => id.toLowerCase()),
)
// Anchored on a single space run rather than a nested quantifier: `\s+WITH\s+(?:\S.*)?$` backtracks
// super-linearly on a long id, and an expression comes from a registry rather than from this repository.
const WITH_EXCEPTION: RegExp = /\sWITH\s[\s\S]*$/i
const OR_LATER: RegExp = /\+$/

const isAllowedId = (id: string): boolean =>
  ALLOWED_FOLDED.has(id.trim().replace(WITH_EXCEPTION, '').replace(OR_LATER, '').toLowerCase())

// The operators, lowest precedence first. SPDX binds AND more tightly than OR, so a correct evaluator
// splits on OR before AND - and the ONLY correct order is that one. Splitting on AND first, after
// stripping the parentheses, turned `(MIT OR Apache-2.0) AND ISC` into the operands
// `MIT OR Apache-2.0` and `ISC`, and then failed the first as though it were an unknown id: every
// mixed expression was reported as a licence violation whatever it actually said.
const OR: string = ' OR '
const AND: string = ' AND '

// How far a fragment leaves the parentheses open, so an operator inside a group is not split on.
const balanceOf = (text: string): number =>
  // Only the two parentheses are counted, and neither of them decomposes.
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- see the note above
  [...text].reduce((depth: number, character: string): number => {
    if (character === '(') {
      return depth + 1
    }
    return character === ')' ? depth - 1 : depth
  }, 0)

// Where the operator occurs at parenthesis depth zero, which is the only place it separates operands.
// An occurrence inside a group belongs to that group: in `(MIT OR Apache-2.0) AND ISC` the OR is the
// group's own, and splitting on it would produce operands the author never wrote.
const splitPoints = (expression: string, operator: string): readonly number[] =>
  [...expression.matchAll(new RegExp(escapeForRegex(operator), 'g'))]
    .map((match: RegExpExecArray): number => match.index)
    .filter((index: number): boolean => balanceOf(expression.slice(0, index)) === 0)

const splitOutside = (expression: string, operator: string): readonly string[] => {
  const points: readonly number[] = splitPoints(expression, operator)
  const ends: readonly number[] = [...points, expression.length]
  return [0, ...points.map((point: number): number => point + operator.length)].map(
    (start: number, index: number): string =>
      expression.slice(start, ends[index] ?? expression.length),
  )
}

const unwrap = (expression: string): string => {
  const trimmed: string = expression.trim()
  return trimmed.startsWith('(') && trimmed.endsWith(')') && balanceOf(trimmed.slice(1, -1)) === 0
    ? unwrap(trimmed.slice(1, -1))
    : trimmed
}

/**
 * Evaluate an SPDX licence expression against the policy.
 *
 * An OR passes when ANY operand does, because the consumer may choose that operand; an AND requires
 * every one; a parenthesised group is evaluated as a unit rather than flattened away.
 * @param expression the declared licence, which may be a compound SPDX expression.
 * @returns whether the policy permits it.
 */
export const isLicenseAllowed = (expression: string): boolean => {
  const clean: string = unwrap(expression)
  const alternatives: readonly string[] = splitOutside(clean, OR)
  if (alternatives.length > 1) {
    return alternatives.some((part: string): boolean => isLicenseAllowed(part))
  }
  const conjuncts: readonly string[] = splitOutside(clean, AND)
  if (conjuncts.length > 1) {
    return conjuncts.every((part: string): boolean => isLicenseAllowed(part))
  }
  return isAllowedId(clean)
}

export interface LicensedPackage {
  readonly name: string
  readonly license: string
}

// Return the packages whose license is not permitted by policy; an empty array means a clean tree.
export const findLicenseViolations = (
  packages: readonly LicensedPackage[],
): readonly LicensedPackage[] =>
  packages.filter((package_: LicensedPackage): boolean => !isLicenseAllowed(package_.license))
