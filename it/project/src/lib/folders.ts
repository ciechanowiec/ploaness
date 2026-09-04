import type { CollectionConfig } from 'payload'
import { nobody } from '@/access'

// Payload builds the folder collection itself, with the access it gives an undeclared operation: any
// signed-in user may do anything. The payload-defaults gate reports that, and this override is how a
// configuration decides the folder tree's access instead.

/** The folder collection as Payload hands it to an override. */
export type FolderCollection = Omit<CollectionConfig, 'trash'>

/**
 * Decide the folder collection's access rather than inheriting Payload's default.
 * @param override - what Payload passes to a folder collection override.
 * @param override.collection - the folder collection as the framework built it.
 * @returns the same collection with every operation decided.
 */
export const foldersAccess = ({
  collection,
}: {
  readonly collection: FolderCollection
}): FolderCollection => ({
  ...collection,
  access: { create: nobody, read: nobody, readVersions: nobody, update: nobody, delete: nobody },
})
