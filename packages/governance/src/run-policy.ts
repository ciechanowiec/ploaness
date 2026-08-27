// When a verification run stops.
//
// The two modes want opposite things from a failure. An enforcing run stops at the first one: nothing
// below a failing gate has been verified, and a gate is free to leave the tree in a shape the next one
// misreads, so a column of passes beneath a failure describes a state nobody established.
//
// A report-only run wants the opposite, because it exists to survey a repository that has not adopted
// the harness yet. Stopping there would report one finding out of the many such a project has, and the
// project would learn its size one run at a time.
//
// One failure stops both. A gate whose failure makes every later gate meaningless is not reporting a
// finding among others - it is saying that ploaness cannot judge this project, or cannot tell whether
// what it is judging is what it thinks. Carrying on produces a list of verdicts about nothing.

/** What decides whether a run carries on after a gate. */
export interface RunPoint {
  /** Whether the gate that just ran failed. */
  readonly isFailure: boolean
  /** Whether a failure here makes every later gate meaningless rather than merely unreported. */
  readonly isPrecondition: boolean
  /** False in report-only mode, where findings print but the run still exits 0. */
  readonly isEnforced: boolean
}

/**
 * Whether this gate ends the run rather than the next one following it.
 * @param point the gate's outcome and the mode the run is in.
 * @returns true when no later gate should run.
 */
export const endsRun = (point: RunPoint): boolean =>
  point.isFailure && (point.isEnforced || point.isPrecondition)

/**
 * Whether a member holds source code its suite could be about.
 *
 * A workspace root is a member - it has to be, to own the scripts a run is invoked through - and it may
 * hold nothing but a manifest. Running a test runner there fails on an empty include, which would report
 * a package with nothing to test as a package that failed to test it.
 *
 * The condition is derived rather than declared, and deliberately narrow: a member holding code and no
 * suite still fails. `--passWithNoTests` would have been the easy answer and the wrong one - it lets an
 * application delete its specs and stay green.
 * @param trackedPaths every tracked path inside the member, member-relative.
 * @param sourceRoots the directories the member declared as holding first-party source.
 * @param isCode whether a path is a code file.
 * @returns true when at least one code file sits under a declared source root.
 */
export const carriesSourceCode = (
  trackedPaths: readonly string[],
  sourceRoots: readonly string[],
  isCode: (filePath: string) => boolean,
): boolean =>
  trackedPaths.some(
    (filePath: string): boolean =>
      isCode(filePath) &&
      sourceRoots.some((root: string): boolean => filePath.startsWith(`${root}/`)),
  )
