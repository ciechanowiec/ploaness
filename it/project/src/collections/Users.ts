import type { CollectionConfig } from 'payload'
import { nobody } from '@/access'

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
  fields: [{ name: 'name', type: 'text', required: true }],
}
