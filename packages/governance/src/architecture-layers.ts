import { DEFAULT_SOURCE_ROOTS } from './settings.js'

// The pure-logic floor, as data rather than as a fixed path.
//
// The architecture contract calls the layer map "the one genuinely project-shaped part" and then named
// `src/access` and `src/lib` in a file a governed project is forbidden to own. A project that puts pure
// logic somewhere else - a configuration layer, a domain directory - could satisfy the intent and still
// fail the rule, with no way to say so. The floor is declared under the `ploaness` key now, and this
// renders it into the shape the analyzer reads.

/** The generated files the floor may depend on, which carry types rather than behaviour. */
const TYPE_ONLY_ARTEFACTS: readonly string[] = ['src/payload-types.ts']

// Every root is spliced into a regular expression, so it has to be escaped on the way in. It was not,
// and both halves of that were live: `src/app/(payload)` - a real directory in a Payload project - read
// as a capture group and matched `src/app/payload/` instead, and a glob-shaped root produced
// `^(src/config/**\/)`, which is not a valid expression at all and took dependency-cruiser down with no
// finding attached. The artefact list beside this one was already escaped; the roots were the half that
// was missed.
const REGEX_METACHARACTERS: RegExp = /[$()*+.?[\\\]^{|}]/gu

// A trailing slash is normalised where the setting is read, so what arrives here is already a bare
// directory. This escapes it, and nothing else.
const asRoot = (directory: string): string => directory.replaceAll(REGEX_METACHARACTERS, String.raw`\$&`)

const alternation = (directories: readonly string[]): string =>
  directories.map((directory: string): string => (directory === '.' ? '' : `${asRoot(directory)}/`)).join('|')

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
  sourceRoots: readonly string[] = DEFAULT_SOURCE_ROOTS,
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
      `under ${sourceRoots.join(', ')} (only types and third-party libs). Pass framework data as a plain ` +
      'value. This is what keeps them unit-testable without mocks.',
    from: { path: `^(${floor})` },
    to: { path: `^(${alternation(sourceRoots)})`, pathNot: `^(${floor})|${exempt}` },
  }
}
