// The harness's own names, in a module small enough for every rule to import.
//
// `version-policy.ts` owned these, and `install-policy.ts` needed them to say which packages may be
// excluded from the release-age floor - while `version-policy.ts` already imports `install-policy.ts`
// for the override reader. Two modules that each need the other is a cycle, and the `arch` gate is
// right to refuse one, so the two names moved down to where neither module has to reach up.

const HARNESS_SCOPE: string = '@ploaness/'

/** The meta package a governed project declares, and the root of everything it inherits from ploaness. */
export const HARNESS_PACKAGE: string = 'ploaness'

/**
 * Whether a package name is one of ploaness's own.
 *
 * Exported because the `deps` gate asks the same question when it walks the manifests a project
 * inherits, and it had no way to ask it but a second copy of the two literals above - which is the
 * shape of drift this repository refuses everywhere else.
 * @param packageName the declared name.
 * @returns true for `ploaness` and for anything under its scope.
 */
export const isHarnessPackage = (packageName: string): boolean =>
  packageName === HARNESS_PACKAGE || packageName.startsWith(HARNESS_SCOPE)
