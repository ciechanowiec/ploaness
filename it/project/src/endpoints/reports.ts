import type { Payload } from 'payload'

/**
 * Report the assets a route's caller may see. A route handler serves whoever reached the URL, so the
 * access decision is stated rather than inherited: Payload defaults `overrideAccess` to true, and a
 * call that says nothing runs as an administrator.
 * @param payload - the Payload instance to read through.
 * @returns the documents the query matched.
 */
export const assetReport = async (payload: Payload): Promise<unknown> =>
  await payload.find({ collection: 'media', depth: 0, limit: 10, overrideAccess: false })
