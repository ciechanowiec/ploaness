/** Framework paths excluded at segment boundaries, independently of project-declared prefixes. */
export const DEFAULT_SKIPPED_ROUTES: readonly string[] = ['/admin', '/api']

/**
 * Keep framework path exclusions narrow while preserving explicit project prefix declarations.
 * @param route the URL path or declared route pattern.
 * @param prefixes the effective list, including framework defaults when applicable.
 * @param customPrefixes explicit declarations, including any that repeat a framework default.
 * @returns whether the route is outside the accessibility sweep.
 */
export const isSkippedRoute = (
  route: string,
  prefixes: readonly string[],
  customPrefixes: readonly string[] = prefixes.filter(
    (prefix: string): boolean => !DEFAULT_SKIPPED_ROUTES.includes(prefix),
  ),
): boolean =>
  prefixes.some(
    (prefix: string): boolean =>
      DEFAULT_SKIPPED_ROUTES.includes(prefix) && (route === prefix || route.startsWith(`${prefix}/`)),
  ) || customPrefixes.some((prefix: string): boolean => route.startsWith(prefix))
