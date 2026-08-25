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

const isAllowedId = (id: string): boolean => ALLOWED.has(id.trim())

// Evaluate an SPDX license expression against the policy. An OR expression passes when ANY operand is
// allowed (the consumer may choose it); an AND expression requires every operand; a bare id must be
// allowed outright.
export const isLicenseAllowed = (expression: string): boolean => {
  const clean: string = expression.replaceAll(/[()]/g, '').trim()
  if (clean.includes(' AND ')) {
    return clean.split(' AND ').every((id: string): boolean => isAllowedId(id))
  }
  if (clean.includes(' OR ')) {
    return clean.split(' OR ').some((id: string): boolean => isAllowedId(id))
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
