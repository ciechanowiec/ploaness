// Classify whether a published release satisfies the install-age floor.

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
