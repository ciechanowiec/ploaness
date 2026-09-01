import type { CollectionConfig } from 'payload'
import { anyone, nobody } from '@/access'

// Access is declared rather than inherited, which is what require-complete-access asks for. The rules
// are referenced by name because an inline function in a config file carries no seam a test can reach.
export const Posts: CollectionConfig = {
  slug: 'posts',
  access: {
    read: anyone,
    create: nobody,
    update: nobody,
    delete: nobody,
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    // A single-value required relationship: the shape that puts a NOT NULL column against a foreign
    // key declared ON DELETE SET NULL, which is what require-relationship-cleanup judges.
    { name: 'author', type: 'relationship', relationTo: 'users', required: true },
  ],
}
