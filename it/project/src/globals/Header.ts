import type { GlobalConfig } from 'payload'

// A global declares read and update; it has neither create nor delete, because it exists from the
// moment it is configured. The fixture carries one so the globals half of require-complete-access is
// exercised rather than left inert.
export const Header: GlobalConfig = {
  slug: 'header',
  access: {
    read: (): boolean => true,
    update: (): boolean => false,
  },
  fields: [{ name: 'title', type: 'text', required: true }],
}
