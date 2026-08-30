// Drift between a generated artefact and the configuration that produces it.
//
// The gate regenerates, then asks whether anything changed. What "changed" means is the whole of the
// decision, and asking git answers a DIFFERENT question: whether the file differs from the INDEX. The
// two part company the moment a developer regenerates as part of the change they are making. The
// artefact then matches its configuration exactly - which is the only thing this gate claims to check -
// and the run fails anyway, telling them to commit a file they have already brought up to date. The
// only way out was to stage the artefact before every run, a step nothing announces and no other gate
// needs.
//
// Comparing the bytes before regeneration with the bytes after asks the question the gate is named for,
// and it holds whatever git has or has not been told.

/** One generated artefact, as the gate saw it either side of regenerating. */
export interface RegeneratedArtefact {
  /** The repo-relative path the generator owns. */
  readonly target: string
  /** Whether git tracks the path, so that what the generator produced is reviewable. */
  readonly isTracked: boolean
  /** The bytes on disk before the generator ran, or undefined when there were none. */
  readonly before: string | undefined
  /** The bytes on disk after it ran, or undefined when the configuration produces no such artefact. */
  readonly after: string | undefined
}

const driftOf = (artefact: RegeneratedArtefact): readonly string[] => {
  // An artefact the configuration does not produce is not this gate's business. A project with no admin
  // panel has no import map, and demanding one would be a rule about the shape of the project.
  if (artefact.after === undefined) {
    return []
  }
  // Asked before drift, because "it drifted" is a strange thing to say about a file git has never seen.
  // An untracked artefact regenerates from a configuration nobody can review, which is a worse fault
  // than drift rather than a milder one.
  if (!artefact.isTracked) {
    return [
      `${artefact.target} is not tracked by git, so no committed version exists to compare against`,
    ]
  }
  return artefact.before === artefact.after ? [] : [`${artefact.target} changed when regenerated`]
}

/**
 * Report every generated artefact that regeneration changed, or that git does not track.
 * @param artefacts each generated path, with the bytes either side of running its generator.
 * @returns one message per artefact that drifted or is untracked, in the order given.
 */
export const findGeneratedDrift = (artefacts: readonly RegeneratedArtefact[]): readonly string[] =>
  artefacts.flatMap((artefact: RegeneratedArtefact): readonly string[] => driftOf(artefact))
