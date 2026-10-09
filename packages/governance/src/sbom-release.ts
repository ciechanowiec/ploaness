import { isArray, readKey } from './json-shapes.js'
import { canonicalInventory } from './sbom-policy.js'

/** The inventory covers resolved workspace inputs, including tools that never enter a deployed bundle. */
export const SBOM_SCOPE: string = 'resolved-workspace-dependencies-including-development'

/** One release file associated with an inventory, measured from its actual bytes. */
export interface ReleaseArtifact {
  readonly path: string
  readonly sha256: string
}

/** Evidence supplied independently from Git and the release files. */
export interface ReleaseEvidence {
  readonly sourceCommit: string
  readonly sbomSha256: string
  readonly artifacts: readonly ReleaseArtifact[]
}

const artifactList = (raw: unknown): readonly ReleaseArtifact[] | undefined => {
  if (!isArray(raw)) {
    return undefined
  }
  const items: readonly (ReleaseArtifact | undefined)[] = raw.map((entry: unknown): ReleaseArtifact | undefined => {
    const path: unknown = readKey(entry, 'path')
    const sha256: unknown = readKey(entry, 'sha256')
    return typeof path === 'string' && typeof sha256 === 'string' ? { path, sha256 } : undefined
  })
  return items.every((entry: ReleaseArtifact | undefined): entry is ReleaseArtifact => entry !== undefined)
    ? items
    : undefined
}

const orderedArtifacts = (artifacts: readonly ReleaseArtifact[]): string =>
  canonicalInventory(
    artifacts.toSorted((left: ReleaseArtifact, right: ReleaseArtifact): number =>
      left.path.localeCompare(right.path, 'en'),
    ),
  )

const matchesArtifacts = (
  artifacts: readonly ReleaseArtifact[] | undefined,
  expected: readonly ReleaseArtifact[],
): boolean =>
  artifacts !== undefined && artifacts.length > 0 && orderedArtifacts(artifacts) === orderedArtifacts(expected)

/** Recovery must preserve the original commit and the bytes originally associated with its SBOM. */
export const releaseInventoryProblems = (metadata: unknown, evidence: ReleaseEvidence): readonly string[] => {
  const artifacts: readonly ReleaseArtifact[] | undefined = artifactList(readKey(metadata, 'artifacts'))
  return [
    ...(readKey(metadata, 'schemaVersion') === 1 && readKey(metadata, 'scope') === SBOM_SCOPE
      ? []
      : ['release inventory metadata has an unsupported schema or scope']),
    ...(readKey(metadata, 'sourceCommit') === evidence.sourceCommit && readKey(metadata, 'sourceDirty') === false
      ? []
      : ['release inventory does not describe the original clean release commit']),
    ...(readKey(metadata, 'sbomSha256') === evidence.sbomSha256 ? [] : ['release inventory SBOM hash does not match']),
    ...(matchesArtifacts(artifacts, evidence.artifacts)
      ? []
      : ['release inventory artifact hashes do not match the release files']),
  ]
}
