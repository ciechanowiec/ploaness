// The recorded schema this template deploys with. Its contents do not matter to the harness; that a
// migration EXISTS is what `require-recorded-migrations` reads, because a project whose adapter cannot
// push has to state its schema somewhere a reader can review. The fail-missing-migrations case removes
// this directory.

/**
 * Apply the initial schema.
 * @returns nothing; a real migration issues its statements here.
 */
export const up = async (): Promise<void> => {
  await Promise.resolve()
}

/**
 * Undo the initial schema.
 * @returns nothing; a real migration reverses its statements here.
 */
export const down = async (): Promise<void> => {
  await Promise.resolve()
}
