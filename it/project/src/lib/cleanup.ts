import type { CollectionBeforeDeleteHook } from 'payload'

/**
 * Remove the posts belonging to an account about to be deleted.
 *
 * A required relationship gives the posts table a NOT NULL column against a foreign key Payload
 * declares ON DELETE SET NULL, so the dependants have to go before their target does. See
 * `require-relationship-cleanup`.
 * @returns nothing; the hook writes another collection rather than this one.
 */
export const removeAuthoredPosts: CollectionBeforeDeleteHook = async ({ id, req }) => {
  await req.payload.delete({
    collection: 'posts',
    where: { author: { equals: id } },
    depth: 0,
    req,
  })
}
