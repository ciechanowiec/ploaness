import { safeHref } from '@ploaness/runtime'

/**
 * Map a URL stored in a CMS field into one safe to render into an anchor.
 *
 * This module exists to be compiled and cruised rather than to be interesting. `@ploaness/runtime` is
 * declared in `dependencies` and imported from `src/**` by value, which is the arrangement the `arch`
 * gate rejects for every devDependency - so a fixture that never performs it would prove the shipped
 * helper is callable from an application only by assertion.
 * @param stored - the raw href as an editor typed it.
 * @returns the href when its scheme is safe or absent, and a neutral link when it is neither.
 */
export const linkFor = (stored: string): string => safeHref(stored)
