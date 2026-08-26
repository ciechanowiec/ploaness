import type { Access } from 'payload'

// The access rules the fixture's configs reference by name. They live here rather than inline in a
// collection because the shipped ESLint config bans an inline function in a config file: a rule written
// there carries no seam a unit test can reach. The fixture is a conforming consumer, so it obeys that
// like any other.

/** Grants the operation to everyone, an unauthenticated client included. */
export const anyone: Access = (): boolean => true

/** Refuses the operation to everyone, so the config decides rather than inheriting a default. */
export const nobody: Access = (): boolean => false
