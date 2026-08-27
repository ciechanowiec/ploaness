// The pure-logic floor, as data rather than as a fixed path.
//
// The architecture contract calls the layer map "the one genuinely project-shaped part" and then named
// `src/access` and `src/lib` in a file a governed project is forbidden to own. A project that puts pure
// logic somewhere else - a configuration layer, a domain directory - could satisfy the intent and still
// fail the rule, with no way to say so. The floor is declared under the `ploaness` key now, and this
// renders it into the shape the analyzer reads.

/** The generated files the floor may depend on, which carry types rather than behaviour. */
const TYPE_ONLY_ARTEFACTS: readonly string[] = ['src/payload-types.ts']

const alternation = (directories: readonly string[]): string =>
  directories.map((directory: string): string => `${directory}/`).join('|')

/**
 * The forbidden rule that keeps the declared pure-logic directories pure.
 *
 * Phrased as "these directories may depend on nothing else under a source root" rather than by listing
 * the layers above them, so a new source directory is governed the moment it exists instead of when
 * somebody remembers to add it here.
 * @param pureLogicRoots the directories forming the floor, repo-relative and without a trailing slash.
 * @returns the dependency-cruiser rule, or undefined when the project declares no floor.
 */
export const pureLogicRule = (
  pureLogicRoots: readonly string[],
): Record<string, unknown> | undefined => {
  if (pureLogicRoots.length === 0) {
    return undefined
  }
  const floor: string = alternation(pureLogicRoots)
  const escaped: readonly string[] = TYPE_ONLY_ARTEFACTS.map((artefact: string): string =>
    artefact.replaceAll('.', String.raw`\.`),
  )
  const exempt: string = escaped.map((artefact: string): string => `^${artefact}$`).join('|')
  return {
    name: 'pure-logic-stays-pure',
    severity: 'error',
    comment:
      `${pureLogicRoots.join(' and ')} are the pure-logic floor: they must depend on nothing else ` +
      'in src (only types and third-party libs). If you need framework data, pass it in as a plain ' +
      'value. This is what keeps them unit-testable without mocks.',
    from: { path: `^(${floor})` },
    to: { path: '^src/', pathNot: `^(${floor})|${exempt}` },
  }
}
