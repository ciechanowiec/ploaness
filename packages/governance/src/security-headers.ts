// The existing browser baseline shared by the home check and checks of individual HTML responses.

const directive = (policy: string, name: string): string | undefined =>
  policy
    .split(';')
    .map((part: string): string => part.trim())
    .find((part: string): boolean => part === name || part.startsWith(`${name} `))

const scriptProblems = (policy: string): readonly string[] => {
  const sources: string | undefined = directive(policy, 'script-src') ?? directive(policy, 'default-src')
  return [
    ...(policy.length === 0 ? ['content-security-policy must be declared'] : []),
    ...(sources === undefined ? ['constrain script through script-src or default-src'] : []),
    ...(sources?.includes("'unsafe-inline'") === true ? ["script sources must not allow 'unsafe-inline'"] : []),
  ]
}

/** Judge the established baseline; this does not attempt complete CSP validation. */
export const securityHeaderProblems = (headers: Readonly<Record<string, string>>): readonly string[] => {
  const policy: string = headers['content-security-policy'] ?? ''
  return [
    ...(headers['x-content-type-options'] === 'nosniff' ? [] : ['x-content-type-options must be nosniff']),
    ...(headers['referrer-policy'] === undefined ? ['referrer-policy must be declared'] : []),
    ...(headers['x-frame-options'] === undefined && directive(policy, 'frame-ancestors') === undefined
      ? ['declare a framing decision through x-frame-options or frame-ancestors']
      : []),
    ...scriptProblems(policy),
  ]
}
