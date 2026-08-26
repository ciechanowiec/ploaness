import type { CollectionConfig } from 'payload'
import { anyone, nobody } from '@/access'

// An upload collection restricts what it will accept. Left undeclared, `mimeTypes` defaults to
// undefined and the collection takes any file, so the fixture carries the restriction and the
// fail-unrestricted-upload case removes it.
export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: anyone,
    create: nobody,
    update: nobody,
    delete: nobody,
  },
  upload: {
    mimeTypes: ['image/png', 'image/jpeg'],
  },
  fields: [{ name: 'alt', type: 'text', required: true }],
}
