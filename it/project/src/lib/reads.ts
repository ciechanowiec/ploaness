import type { Payload } from 'payload'

type LocalUser = Parameters<Payload['find']>[0]['user']

/**
 * Read the most recent posts. Both bounds are declared, so the read cannot pull an unbounded
 * relationship graph, and access control is enabled for the user whose documents are requested.
 * @param payload - the Payload instance to read through.
 * @param user - the caller whose access rules constrain the result.
 * @returns the documents the query matched.
 */
export const recentPosts = async (payload: Payload, user: LocalUser): Promise<unknown> =>
  await payload.find({ collection: 'posts', depth: 0, limit: 10, user, overrideAccess: false })
