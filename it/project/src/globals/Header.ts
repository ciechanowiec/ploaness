import type { GlobalConfig } from 'payload'
import { anyone, nobody } from '@/access'

// A global declares read and update; it has neither create nor delete, because it exists from the
// moment it is configured. The fixture carries one so the globals half of require-complete-access is
// exercised rather than left inert.
export const Header: GlobalConfig = {
  slug: 'header',
  access: {
    read: anyone,
    update: nobody,
  },
  fields: [{ name: 'title', type: 'text', required: true }],
}
