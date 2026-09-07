// A subject the hosting platform wrote is not the author's. A platform that completes a pull request as
// a squash writes the start of the squash commit's subject itself: Azure DevOps prefixes the pull request
// title with `Merged PR <number>: ` and offers no other default. A project whose pull requests land that
// way therefore had every commit on its default branch fail the header rule, for characters nobody typed.
//
// This module sets that prefix aside, and only where the platform demonstrably wrote it: the project has
// declared the platform, the commit has exactly one parent, and it sits on the branch the platform merges
// into. Everything after the prefix is the author's and is judged in full. The same prefix on a commit
// with two parents, or off that branch, is a hand-written subject imitating the platform, and is a
// finding of its own rather than a pass. Nothing here reads a pending message: `commit-message <file>`
// judges what an author is writing, and the platform is not writing it.

/** The hosting platforms whose squash subject ploaness recognises. */
export type SquashPlatform = 'azure-devops'

// Each platform by the prefix it writes. A catalogue rather than a pattern the project declares: a
// declarable pattern is an exemption list by another name, and `.*` would have excused every subject.
const SUBJECT_PREFIXES: Readonly<Record<SquashPlatform, RegExp>> = {
  'azure-devops': /^Merged PR \d+: /,
}

/** Every platform the catalogue names, for a settings reader to accept and a finding to list. */
export const SQUASH_PLATFORMS: readonly SquashPlatform[] = ['azure-devops']

// A squash commit records the merged-into tip as its only parent. Two parents is a merge, whatever the
// subject says, and zero is a root commit no platform wrote.
const SQUASH_PARENT_COUNT: number = 1

/**
 * Decide whether a settings value names a platform in the catalogue.
 * @param raw the declared `platform`, as read from package.json.
 * @returns true when it is one ploaness recognises.
 */
export const isSquashPlatform = (raw: unknown): raw is SquashPlatform =>
  typeof raw === 'string' && (SQUASH_PLATFORMS as readonly string[]).includes(raw)

/** How a project's pull requests reach its history: the platform that squashes them, and into which branch. */
export interface SquashMergePolicy {
  readonly platform: SquashPlatform
  /** The branch the platform merges into, and the only place its prefix is set aside. */
  readonly branch: string
}

/** One commit reduced to the facts the squash rule needs. */
export interface SquashCandidate {
  readonly header: string
  /** How many parents git recorded, which no subject can forge. */
  readonly parentCount: number
  /** Whether the commit is reachable from the declared branch. */
  readonly isOnBranch: boolean
}

/** The subject the message rules should judge, and what was wrong with the prefix, if anything. */
export interface SquashVerdict {
  /** The header with the platform's prefix removed, or the header as written when there was none. */
  readonly header: string
  readonly problems: readonly string[]
}

const asWritten = (header: string): SquashVerdict => ({ header, problems: [] })

/**
 * Set the platform's squash prefix aside where the platform wrote it, and report it where it did not.
 *
 * The remainder is returned even when the prefix was illegitimate, so one run reports every defect of
 * the subject rather than the prefix alone and the header rule again for the same characters.
 * @param candidate the commit's header and the facts git recorded about it.
 * @param policy the declared platform and branch, or undefined for a project that declared none.
 * @returns the header to hold to the message rules, and a problem per way the prefix was illegitimate.
 */
export const settleSquashSubject = (
  candidate: SquashCandidate,
  policy: SquashMergePolicy | undefined,
): SquashVerdict => {
  if (policy === undefined) {
    return asWritten(candidate.header)
  }
  const match: RegExpExecArray | null = SUBJECT_PREFIXES[policy.platform].exec(candidate.header)
  if (match === null) {
    return asWritten(candidate.header)
  }
  const written: string = match[0]
  const prefix: string = `carries the ${policy.platform} squash prefix "${written}"`
  const problems: readonly string[] = [
    ...(candidate.parentCount === SQUASH_PARENT_COUNT
      ? []
      : [
          `${prefix} but has ${String(candidate.parentCount)} parent(s); a squash commit has ` +
            `exactly ${String(SQUASH_PARENT_COUNT)}`,
        ]),
    ...(candidate.isOnBranch
      ? []
      : [
          `${prefix} but is not on ${policy.branch}, the only branch ${policy.platform} writes it ` +
            'on; a hand-written subject must not imitate the platform',
        ]),
  ]
  return { header: candidate.header.slice(written.length), problems }
}
