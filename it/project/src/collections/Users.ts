import type { CollectionConfig } from 'payload'

// An auth collection, so the hardening rule and the public-create rule are both exercised rather than
// left inert. `create` is closed here; the fail-public-auth-create case opens it.
export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    maxLoginAttempts: 5,
    lockTime: 600_000,
  },
  access: {
    read: (): boolean => false,
    create: (): boolean => false,
    update: (): boolean => false,
    delete: (): boolean => false,
  },
  fields: [{ name: 'name', type: 'text', required: true }],
}
