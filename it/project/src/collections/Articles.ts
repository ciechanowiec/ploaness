import type { CollectionConfig } from 'payload'
import { nobody, publishedOnly } from '@/access'

// Drafts, with the read a drafts collection owes a stranger. The fail-drafts-unconstrained-read case
// drops the status clause from `publishedOnly` and the fail-drafts-open-read case swaps the rule for
// one that admits anyone: both are reads a conforming project can write, and both were passing before
// payload-defaults began asking what a drafts read answers a caller with no credentials.
export const Articles: CollectionConfig = {
  slug: 'articles',
  versions: { drafts: true },
  access: {
    read: publishedOnly,
    create: nobody,
    update: nobody,
    delete: nobody,
    readVersions: nobody,
  },
  fields: [{ name: 'title', type: 'text', required: true }],
}
