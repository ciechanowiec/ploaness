// The registry reads behind the image half of the freshness report.
//
// Everything that decides anything lives in `@ploaness/governance`: what a stable tag is, which tags
// are comparable with the pinned one, which is newest, and how a finding reads. What is left here is
// the HTTP, which is why this file is in the CLI at all.
//
// A newer image never fails the run. The freshness bound is a claim about a release line, and a tag is
// not required to carry one - so an update is reported and the build carries on. Failure stays where
// the guideline puts it: a declaration this cannot parse, or a registry that cannot say what is current.
import {
  asRecord,
  CONTAINER_IMAGES,
  type ContainerInspection,
  type ContainerReference,
  type ContainerTag,
  type ContainerVerdict,
  describeContainerDrift,
  describeContainerUpdate,
  isArray,
  judgeContainer,
  parseContainerReference,
} from '@ploaness/governance'

const DOCKER_HUB: string = 'https://hub.docker.com'
const PAGE_SIZE: number = 100
// Enough for the largest repository the harness pins; hadolint publishes several hundred tags.
const MAX_PAGES: number = 10
const REQUEST_TIMEOUT_MS: number = 30_000
const FIRST_PAGE: number = 1

/** What the image half of the freshness report found, or why it could not look. */
export interface ImageReport {
  readonly scanned: number
  /** Report lines, each already phrased for the gate's finding list. */
  readonly lines: readonly string[]
  /** Set when the registry could not establish what is current, which fails the gate. */
  readonly failure: string | undefined
}

const fetchJson = async (url: string): Promise<unknown> => {
  const response: Response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`Docker Hub returned ${String(response.status)} for ${url}`)
  }
  return await response.json()
}

const repoUrl = (reference: ContainerReference): string =>
  `${DOCKER_HUB}/v2/namespaces/${reference.namespace}/repositories/${reference.repository}`

const tagNames = (body: unknown): readonly string[] => {
  const results: unknown = asRecord(body)['results']
  if (!isArray(results)) {
    throw new TypeError('Docker Hub returned no tag list')
  }
  return results
    .map((entry: unknown): unknown => asRecord(entry)['name'])
    .filter((name: unknown): name is string => typeof name === 'string')
}

// Paged rather than taking the first hundred. A repository that publishes every patch of every minor
// pushes its newest tag off page one within a year, and reading only that page would report "current"
// forever - a silent wrong answer, which is worse than the failure an unreachable registry produces.
const tagsFrom = async (
  reference: ContainerReference,
  page: number,
  soFar: readonly string[],
): Promise<readonly string[]> => {
  const names: readonly string[] = tagNames(
    await fetchJson(
      `${repoUrl(reference)}/tags?page_size=${String(PAGE_SIZE)}&page=${String(page)}`,
    ),
  )
  const collected: readonly string[] = [...soFar, ...names]
  return names.length < PAGE_SIZE || page >= MAX_PAGES
    ? collected
    : await tagsFrom(reference, page + 1, collected)
}

const digestOf = async (reference: ContainerReference, tag: string): Promise<string> => {
  const answered: unknown = await fetchJson(`${repoUrl(reference)}/tags/${tag}`)
  const digest: unknown = asRecord(answered)['digest']
  if (typeof digest !== 'string') {
    throw new TypeError(`Docker Hub returned no digest for ${reference.name}:${tag}`)
  }
  return digest
}

const inspect = async (reference: ContainerReference): Promise<ContainerInspection> => ({
  reference,
  available: await tagsFrom(reference, FIRST_PAGE, []),
  currentDigest: await digestOf(reference, reference.tag),
})

// The replacement digest is read only where an update exists, so a fully current harness costs one
// extra request per image rather than two.
const describe = async (verdict: ContainerVerdict): Promise<readonly string[]> => {
  const newer: ContainerTag | undefined = verdict.newer
  const update: readonly string[] =
    newer === undefined
      ? []
      : [
          describeContainerUpdate(
            verdict.reference,
            newer,
            await digestOf(verdict.reference, newer.raw),
          ),
        ]
  const drift: readonly string[] = verdict.hasDrifted
    ? [describeContainerDrift(verdict.reference, verdict.currentDigest)]
    : []
  return [...update, ...drift]
}

/**
 * Read every image the harness pins against its registry.
 * @returns the report lines, or the failure that stopped the registry from answering.
 */
export const imageFreshness = async (): Promise<ImageReport> => {
  const declared: readonly (ContainerReference | undefined)[] = Object.entries(
    CONTAINER_IMAGES,
  ).map(([tool, reference]: readonly [string, string]): ContainerReference | undefined =>
    parseContainerReference(tool, reference),
  )
  const pinned: readonly ContainerReference[] = declared.filter(
    (reference: ContainerReference | undefined): reference is ContainerReference =>
      reference !== undefined,
  )
  if (pinned.length !== declared.length) {
    return {
      scanned: 0,
      lines: [],
      failure:
        `${String(declared.length - pinned.length)} pinned image(s) are not written as ` +
        '<repo>:<tag>@sha256:<digest>',
    }
  }
  try {
    const inspected: readonly ContainerInspection[] = await Promise.all(
      pinned.map(
        async (reference: ContainerReference): Promise<ContainerInspection> => inspect(reference),
      ),
    )
    const verdicts: readonly ContainerVerdict[] = inspected.map(
      (inspection: ContainerInspection): ContainerVerdict => judgeContainer(inspection),
    )
    const described: readonly (readonly string[])[] = await Promise.all(
      verdicts.map(
        async (verdict: ContainerVerdict): Promise<readonly string[]> => describe(verdict),
      ),
    )
    return { scanned: pinned.length, lines: described.flat(), failure: undefined }
  } catch (error: unknown) {
    const reason: string = error instanceof Error ? error.message : String(error)
    return {
      scanned: pinned.length,
      lines: [],
      failure: `the image registry could not establish what is current: ${reason}`,
    }
  }
}
