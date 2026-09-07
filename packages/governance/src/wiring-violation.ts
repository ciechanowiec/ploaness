// Share the finding type used by wiring and dependency-version checks.

/** A defect in how the consuming project has wired ploaness into itself. */
export interface WiringViolation {
  readonly location: string
  readonly reason: string
}
