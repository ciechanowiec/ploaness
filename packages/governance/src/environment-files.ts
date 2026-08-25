// The environment files a run of the project reads into its own process.
//
// A Payload config validates `process.env` at module scope, so anything that boots the project boots
// its configuration first. Next reads these files itself, which is why the application under test never
// had a problem - but a test runner does not, and the runner ploaness ships a Playwright config for
// boots the project in its OWN process: an end-to-end helper that seeds a user through `getPayload`
// evaluates `payload.config.ts` at spec-collection time, before a browser or a server is involved.
//
// The project used to load them from its own `playwright.config.ts`. The wiring gate now requires that
// file to be a bare re-export, which removes the only seam it had, so the harness that took the seam
// away owes the load. Vitest is the other half of the same shape and keeps its own answer: a project
// writes `vitest.setup.ts` and ploaness loads it, which is a seam the project still owns.
//
// The order is the part that carries meaning, and it is stated here rather than at the call site so
// that it is measured: `packages/config` is an analyzer configuration that no coverage floor reads,
// while everything in this package is unit-tested. Nothing loaded later may replace a value already
// set, so the file that must win is read first, and a variable the real environment already carries -
// a CI secret, a `DATABASE_URL` exported by a service container - outranks every file, because it was
// there before any of them was read.

/**
 * The environment files a run reads, highest precedence first. `.env.local` leads because it is the
 * personal, untracked override of `.env`; the managed `.gitignore` ignores both, which is what makes
 * these the two a project can be assumed to keep out of the tree.
 */
export const RUN_ENVIRONMENT_FILES: readonly string[] = ['.env.local', '.env']

/**
 * The environment files a run should read, in the order it must read them.
 * @param isExistingFile whether a repository-relative path names a file that exists.
 * @returns the present subset of {@link RUN_ENVIRONMENT_FILES}, highest precedence first.
 */
export const runEnvironmentFiles = (
  isExistingFile: (relativePath: string) => boolean,
): readonly string[] =>
  RUN_ENVIRONMENT_FILES.filter((file: string): boolean => isExistingFile(file))
