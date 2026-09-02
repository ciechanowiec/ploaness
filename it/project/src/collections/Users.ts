import type { CollectionConfig } from 'payload'
import { nobody, nobodyField } from '@/access'
import { removeAuthoredPosts } from '@/lib/cleanup'

// An auth collection, so the hardening rule and the public-create rule are both exercised rather than
// left inert. `create` is closed here; the fail-public-auth-create case opens it.
export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    maxLoginAttempts: 5,
    lockTime: 600_000,
  },
  access: {
    read: nobody,
    create: nobody,
    update: nobody,
    delete: nobody,
  },
  // Posts point at this collection with a required relationship, so its rows cannot be deleted unless
  // their dependants go first. The fail-relationship-cleanup case removes this line.
  hooks: {
    beforeDelete: [removeAuthoredPosts],
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'isAdmin',
      type: 'checkbox',
      access: {
        create: nobodyField,
        update: nobodyField,
      },
    },
  ],
}
