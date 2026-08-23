import type { CollectionConfig } from 'payload'

// Access is declared rather than inherited, which is what the require-collection-access rule asks for.
export const Posts: CollectionConfig = {
  slug: 'posts',
  access: {
    read: (): boolean => true,
    create: (): boolean => false,
    update: (): boolean => false,
    delete: (): boolean => false,
  },
  fields: [{ name: 'title', type: 'text', required: true }],
}
