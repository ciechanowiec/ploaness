// Whether a published release is old enough to be installed at all.
//
// pnpm refuses a release younger than a minimum age. That guards against a compromised publish: a
// malicious version is usually pulled within hours of being noticed, so the wait costs a day and buys
// the window in which the registry corrects itself. The freshness report has to know about it, because
// an update named without it sends a reader to an install pnpm will refuse, and the reader then either
// waits without knowing why or spends the guard on an exclusion to get past it.
//
// The floor is pnpm's rather than ploaness's, and pnpm neither documents the default nor answers
// `pnpm config get minimumReleaseAge` for it. The value below was established by observation - refused
// at 13h and again at 23h58m, taken at 33h and at six days - so it is stated as a named constant a
// reader can check and a maintainer can correct, rather than buried inside a comparison.
//
// Held is a third thing the report can say, not a fourth verdict the gate can reach. Nothing here
// fails a build: a release too young to install is a fact about the registry, never a defect in the
// project reading it.

const MILLISECONDS_PER_HOUR: number = 3_600_000

/** Hours a published release must have existed before pnpm will install it. */
export const RELEASE_AGE_FLOOR_HOURS: number = 24

/** A release's publication instant measured against now, both as epoch milliseconds. */
export interface ReleaseAge {
  /** When the release was published, or undefined when the registry did not say. */
  readonly publishedAt: number | undefined
  /** The instant to measure the publication against. */
  readonly now: number
}

/**
 * Whole hours a release has existed, so a report can say how much of the wait is left.
 * @param age the publication instant and the instant to measure it against.
 * @returns the floored hours, or `undefined` when the publication instant is unknown.
 */
export const hoursPublished = (age: ReleaseAge): number | undefined =>
  age.publishedAt === undefined
    ? undefined
    : Math.floor((age.now - age.publishedAt) / MILLISECONDS_PER_HOUR)

/**
 * Whether pnpm would refuse this release for being younger than the floor.
 * @param age the publication instant and the instant to measure it against.
 * @returns true only when the age is KNOWN and below the floor. An unknown date is never held, because
 * a report that guessed would withhold an update the project can take today.
 */
export const isHeldByReleaseAge = (age: ReleaseAge): boolean => {
  const hours: number | undefined = hoursPublished(age)
  return hours !== undefined && hours < RELEASE_AGE_FLOOR_HOURS
}
