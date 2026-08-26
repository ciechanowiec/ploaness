import type { Payload } from 'payload'

/**
 * Read the most recent posts. Both bounds are declared, so the read cannot pull an unbounded
 * relationship graph, which is what the no-unbounded-find rule asks of every Local API call.
 * @param payload - the Payload instance to read through.
 * @returns the documents the query matched.
 */
export const recentPosts = async (payload: Payload): Promise<unknown> =>
  await payload.find({ collection: 'posts', depth: 0, limit: 10 })
