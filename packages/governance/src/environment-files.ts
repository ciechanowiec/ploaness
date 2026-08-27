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

/**
 * The port an origin names, as a string a child process's environment can carry.
 *
 * A project declares the origin its application serves, and ploaness starts that application itself.
 * Reading the origin without reading the port meant the two disagreed: the server was started on the
 * framework's default while the runner waited on the declared one, so the only setting that exists to
 * describe a non-default port made the run hang rather than work.
 * @param serverUrl the declared origin.
 * @returns the port, or undefined when the origin names none and the default applies.
 */
export const portOf = (serverUrl: string): string | undefined => {
  try {
    const port: string = new URL(serverUrl).port
    return port.length > 0 ? port : undefined
  } catch {
    // A malformed origin is the project's to fix, and the gate that drives it will say so far more
    // clearly than a crash inside a configuration file that no stack trace points at.
    return undefined
  }
}

/**
 * The variables a run must be GIVEN, as distinct from the ones it inherits.
 *
 * `process.loadEnvFile` is the answer where the process reading the files is the process that boots the
 * project. A gate is not: it starts a CHILD, and mutating the gate's own environment to configure that
 * child would take the project's settings into the harness for every gate after it. So the same
 * precedence has to be rebuilt as an override map - and it is the REVERSE of what spawning does by
 * default, where an override beats the inherited value. Here a file must LOSE to a variable the run
 * already carries, for the reason stated above: that variable was there before any file was read.
 *
 * Returning only the names the run lacks is what makes that safe to hand to a plain merge. The
 * alternative, merging the files under `process.env`, silently reinstates any name the parent happens
 * to carry as empty rather than absent.
 * @param current the environment the run already has, typically `process.env`.
 * @param parsedFiles the parsed files, in the order {@link runEnvironmentFiles} returned them.
 * @returns the names the run does not carry, each with the value of the FIRST file to declare it.
 */
export const runEnvironmentOverrides = (
  current: Readonly<Record<string, string | undefined>>,
  parsedFiles: readonly Readonly<Record<string, string | undefined>>[],
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    parsedFiles
      .flatMap(
        (
          file: Readonly<Record<string, string | undefined>>,
        ): readonly [string, string | undefined][] => Object.entries(file),
      )
      .filter(
        (entry: readonly [string, string | undefined]): entry is [string, string] =>
          entry[1] !== undefined && current[entry[0]] === undefined,
      )
      // Among the files the earliest wins, and `Object.fromEntries` gives the LAST entry for a repeated
      // name, so the list is reversed rather than de-duplicated by hand.
      .toReversed(),
  )
