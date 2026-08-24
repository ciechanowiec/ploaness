// The one type the wiring rules and the version rules both speak.
//
// It lived in `wiring-policy.ts`, which imports `version-policy.ts` for the version rules, while
// `version-policy.ts` imported the type back. That is a cycle, and the governing standard says a cycle
// is broken by moving the shared concept into a unit both sides depend on rather than by declaring it
// acceptable. This module is that unit: it declares a type and imports nothing.

/** A defect in how the consuming project has wired ploaness into itself. */
export interface WiringViolation {
  readonly location: string
  readonly reason: string
}
