import type { Payload } from 'payload'

// Both bounds are declared, so the read cannot pull an unbounded relationship graph.
export const recentPosts = async (payload: Payload): Promise<unknown> =>
  await payload.find({ collection: 'posts', depth: 0, limit: 10 })
