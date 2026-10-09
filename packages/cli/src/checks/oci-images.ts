// Public GHCR metadata for the image pinned by the SBOM command; execution remains digest-bound.
import { type ContainerReference, isArray, REQUEST_TIMEOUT_MS, readKey } from '@ploaness/governance'

const REGISTRY: string = 'https://ghcr.io'
const PAGE_SIZE: number = 100
const MAX_PAGES: number = 100
const ACCEPT: string =
  'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json'

const authorization = async (reference: ContainerReference): Promise<string> => {
  const scope: string = `repository:${reference.namespace}/${reference.repository}:pull`
  const response: Response = await fetch(`${REGISTRY}/token?service=ghcr.io&scope=${encodeURIComponent(scope)}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`GHCR authentication returned HTTP ${String(response.status)}`)
  }
  const credential: unknown = readKey(await response.json(), 'token')
  if (typeof credential !== 'string' || credential.length === 0) {
    throw new TypeError('GHCR returned no public pull token')
  }
  return `Bearer ${credential}`
}

const registryRead = async (reference: ContainerReference, suffix: string): Promise<Response> => {
  const response: Response = await fetch(`${REGISTRY}/v2/${reference.namespace}/${reference.repository}/${suffix}`, {
    headers: { Authorization: await authorization(reference), Accept: ACCEPT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`GHCR returned HTTP ${String(response.status)} for ${reference.name}`)
  }
  return response
}

const parsedTags = (body: unknown): readonly string[] => {
  const tags: unknown = readKey(body, 'tags')
  if (!(isArray(tags) && tags.every((tag: unknown): tag is string => typeof tag === 'string'))) {
    throw new TypeError('GHCR returned no readable tag list')
  }
  return tags
}

/** Read all public tags, failing rather than treating a truncated list as complete. */
export const ociTags = async (
  reference: ContainerReference,
  previous: string = '',
  page: number = 0,
): Promise<readonly string[]> => {
  if (page >= MAX_PAGES) {
    throw new Error(`GHCR tag inventory for ${reference.name} exceeded its page bound`)
  }
  const response: Response = await registryRead(
    reference,
    `tags/list?n=${String(PAGE_SIZE)}&last=${encodeURIComponent(previous)}`,
  )
  const tags: readonly string[] = parsedTags(await response.json())
  const last: string | undefined = tags.at(-1)
  if (last === undefined || tags.length < PAGE_SIZE) {
    return tags
  }
  if (last === previous) {
    throw new Error('GHCR tag pagination did not advance')
  }
  return [...tags, ...(await ociTags(reference, last, page + 1))]
}

/** Read the multi-platform index digest, matching the bytes named by the toolchain pin. */
export const ociDigest = async (reference: ContainerReference, tag: string): Promise<string> => {
  const response: Response = await registryRead(reference, `manifests/${encodeURIComponent(tag)}`)
  const digest: string | null = response.headers.get('docker-content-digest')
  if (digest === null || !/^sha256:[a-f\d]{64}$/.test(digest)) {
    throw new TypeError('GHCR returned no immutable image digest')
  }
  return digest
}
