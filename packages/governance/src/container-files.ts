// Which files in a tracked tree are container definitions, and which directories hold a compose project.
//
// Discovery is stated here for both kinds at once, because stating it for only one is how the two halves
// drifted. The Dockerfile half already walked the tracked tree - a project may keep a Dockerfile in any
// directory, and a hard-coded path would silently skip the ones it did not anticipate - while the compose
// half looked at the repository root and nowhere else. A Payload project that keeps its application in a
// member directory keeps its compose file beside it, so the gate linted that member's Dockerfile and
// reported a pass having validated no compose project at all.

/** A directory compose would treat as a project, and the file that identifies it. */
export interface ComposeProject {
  /** Repo-relative directory holding the project; empty at the repository root. */
  readonly directory: string
  /** Repo-relative path of the file that identified it. */
  readonly file: string
}

// Sliced rather than split, so neither helper carries a case that cannot happen. `lastIndexOf`
// returns -1 for a bare basename, which makes these the whole string and the empty string - the two
// answers a repository-root file wants - without a fallback no input could reach.
const basenameOf = (file: string): string => file.slice(file.lastIndexOf('/') + 1)

const directoryOf = (file: string): string => file.slice(0, Math.max(file.lastIndexOf('/'), 0))

// The names compose reads on its own, in the precedence it applies to them.
//
// An override file is deliberately absent: compose merges one into the project its base file defines, so
// a directory is validated once, through that base. Discovering an override as a project of its own would
// hand compose a fragment to validate alone and report a defect the project does not have.
const COMPOSE_BASENAMES: readonly string[] = [
  'compose.yaml',
  'compose.yml',
  'docker-compose.yaml',
  'docker-compose.yml',
]

/**
 * Decide whether a path names a Dockerfile.
 * @param file a repo-relative path.
 * @returns true when the file is a Dockerfile under any of its conventional spellings.
 */
export const isDockerfile = (file: string): boolean => {
  const name: string = basenameOf(file)
  return name === 'Dockerfile' || name.endsWith('.Dockerfile') || name.startsWith('Dockerfile.')
}

/**
 * Decide whether a path names a file compose would read on its own.
 * @param file a repo-relative path.
 * @returns true when the file identifies a compose project.
 */
export const isComposeFile = (file: string): boolean => COMPOSE_BASENAMES.includes(basenameOf(file))

// Where a name sits in compose's own precedence. Only ever asked of a file `isComposeFile` accepted,
// so the -1 `indexOf` returns for anything else is unreachable rather than meaningful.
const precedenceOf = (file: string): number => COMPOSE_BASENAMES.indexOf(basenameOf(file))

/**
 * Every Dockerfile the repository tracks.
 * @param tracked the repo-relative paths of the tracked files.
 * @returns the Dockerfiles, ordered so a report reads the same on every machine.
 */
export const dockerfilesIn = (tracked: readonly string[]): readonly string[] =>
  tracked
    .filter((file: string): boolean => isDockerfile(file))
    .toSorted((left: string, right: string): number => left.localeCompare(right))

/**
 * Every compose project the repository tracks, one per directory.
 *
 * Grouped by directory rather than listed per file, because that is the unit compose itself validates: it
 * reads the base file and every override beside it as one project, and the directory is what a
 * developer's own `docker compose config` would be run from.
 * @param tracked the repo-relative paths of the tracked files.
 * @returns one project per directory holding a compose file, in directory order.
 */
export const composeProjectsIn = (tracked: readonly string[]): readonly ComposeProject[] => {
  const found: readonly string[] = tracked.filter((file: string): boolean => isComposeFile(file))
  return [...new Set<string>(found.map((file: string): string => directoryOf(file)))]
    .toSorted((left: string, right: string): number => left.localeCompare(right))
    .flatMap((directory: string): readonly ComposeProject[] =>
      // The directory's files are ranked and the first is taken, rather than the names being tried in
      // order against the list. Both spell compose's precedence; only this one is total, so there is no
      // "no file matched" case to answer for in a directory that is here because a file matched.
      found
        .filter((file: string): boolean => directoryOf(file) === directory)
        .toSorted((left: string, right: string): number => precedenceOf(left) - precedenceOf(right))
        .slice(0, 1)
        .map((file: string): ComposeProject => ({ directory, file })),
    )
}
