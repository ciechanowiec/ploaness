// Managed-file policy. Some configuration is read
// from the working tree by tools ploaness does not run (git, editors, coding agents), so it cannot live
// inside the package and be resolved through node_modules the way an ESLint or Biome config can. Those
// files are materialised into the consumer tree by `ploaness sync` and policed here.
//
// Four dispositions:
//   PINNED    - ploaness owns the content; the file must exist and match byte for byte.
//   SEED      - ploaness writes it once when absent; the project owns it thereafter and may edit it.
//   FORBIDDEN - the path must not exist, because ploaness supplies that configuration itself and a
//               working-tree copy would silently shadow or contradict it.
//   SECTION   - ploaness owns a marked block at the top of the file; the project owns everything below
//               it. Neither PINNED nor SEED fits a file both parties must write: pinning it would forbid
//               the project its own agent instructions, and seeding it would let the contract statement
//               drift the moment ploaness changed.

/** How ploaness treats a path in the consumer working tree. */
export type Disposition = 'PINNED' | 'SEED' | 'FORBIDDEN' | 'SECTION'

/** One catalogue entry: a repo-relative path and the disposition ploaness applies to it. */
export interface ManagedAsset {
  readonly path: string
  readonly disposition: Disposition
}

/** A managed-file defect found in the consumer working tree. */
export interface AssetViolation {
  readonly path: string
  readonly reason: string
}

/** The working-tree facts the policy needs, injected so the core stays free of filesystem access. */
export interface AssetState {
  /** Whether the path exists in the consumer working tree. */
  readonly exists: boolean
  /** The working-tree content, or undefined when the path is absent. */
  readonly actual: string | undefined
  /** The content ploaness ships for the path, or undefined for a FORBIDDEN entry. */
  readonly expected: string | undefined
}

/** The outcome of parsing a manifest: the entries, and any rows too malformed to honour. */
export interface ParsedManifest {
  readonly assets: readonly ManagedAsset[]
  readonly problems: readonly string[]
}

const DISPOSITIONS: ReadonlySet<string> = new Set<string>([
  'PINNED',
  'SEED',
  'FORBIDDEN',
  'SECTION',
])

/** Opens the block ploaness owns inside a SECTION file. */
export const SECTION_BEGIN: string = '<!-- BEGIN PLOANESS MANAGED INSTRUCTIONS -->'

/** Closes the block ploaness owns inside a SECTION file. */
export const SECTION_END: string = '<!-- END PLOANESS MANAGED INSTRUCTIONS -->'

/**
 * What a SECTION file currently carries. The three cases are not interchangeable: `absent` is a file
 * ploaness may safely write into, `present` is a block it may compare and replace, and `malformed` is a
 * file it must refuse, because every automatic repair of ambiguous markers risks swallowing or
 * duplicating text the project owns.
 */
export type SectionState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly block: string }
  | { readonly kind: 'malformed'; readonly reason: string }

const occurrences = (content: string, marker: string): number => content.split(marker).length - 1

/**
 * Read back the ploaness-owned block, markers included.
 *
 * The markers are HTML comments so they survive in every Markdown renderer without being visible to a
 * human reader, and so an agent editing the file below them can see exactly where its own territory
 * starts. The block must lead the file and appear exactly once: a contract an agent reaches only after
 * scrolling past the project's own prose is not the first thing it reads, and a second copy would let
 * one block drift while the other stayed current.
 * @param content the whole file as it currently stands in the working tree.
 * @returns which of the three states the file is in.
 */
export const readManagedSection = (content: string): SectionState => {
  const begins: number = occurrences(content, SECTION_BEGIN)
  const ends: number = occurrences(content, SECTION_END)
  if (begins === 0 && ends === 0) {
    return { kind: 'absent' }
  }
  if (begins !== 1 || ends !== 1) {
    return {
      kind: 'malformed',
      reason: 'the managed markers appear more than once, or one is missing',
    }
  }
  // Requiring the block to lead the file also settles marker order: with one of each marker and the
  // begin marker at offset zero, the end marker can only follow it.
  if (!content.startsWith(`${SECTION_BEGIN}\n`)) {
    return { kind: 'malformed', reason: 'the managed block does not begin the file' }
  }
  const end: number = content.indexOf(SECTION_END)
  return { kind: 'present', block: content.slice(0, end + SECTION_END.length) }
}

/**
 * Put the ploaness-owned block into a file, preserving everything the project owns.
 *
 * An existing block is replaced where it stands, so the project text below it is carried through
 * byte for byte. A file with no block gets one at the very top, because the contract has to be the
 * first thing an agent reads.
 * @param content the current file, or the empty string when it does not exist yet.
 * @param block the block ploaness ships, markers included.
 * @returns the spliced file, or undefined when the markers are too ambiguous to edit safely.
 */
export const applyManagedSection = (content: string, block: string): string | undefined => {
  const state: SectionState = readManagedSection(content)
  if (state.kind === 'malformed') {
    return undefined
  }
  if (state.kind === 'present') {
    return block + content.slice(state.block.length)
  }
  return content.trim().length === 0 ? `${block}\n` : `${block}\n\n${content.replace(/^\n+/, '')}`
}

/**
 * Parse a manifest into catalogue entries. Blank lines and `#` comments are ignored; a row is a
 * repo-relative path, a tab, and a disposition. A malformed row is reported rather than silently
 * skipped, so a packaging mistake cannot quietly shrink the catalogue.
 * @param manifest the raw manifest.tsv contents.
 * @returns the parsed entries and any malformed rows.
 */
export const parseManifest = (manifest: string): ParsedManifest => {
  const assets: ManagedAsset[] = []
  const problems: string[] = []
  for (const [index, line] of manifest.split('\n').entries()) {
    const trimmed: string = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue
    }
    const [path, disposition] = trimmed.split('\t')
    if (path === undefined || disposition === undefined || !DISPOSITIONS.has(disposition)) {
      problems.push(
        `manifest line ${index + 1}: expected "<path>", a tab, then PINNED, SEED, FORBIDDEN, or SECTION`,
      )
      continue
    }
    assets.push({ path, disposition: disposition as Disposition })
  }
  return { assets, problems }
}

/**
 * Judge a path whose marked block ploaness owns and whose remaining text the project owns.
 * @param asset the catalogue entry.
 * @param state the working-tree and shipped content for that path.
 * @returns a violation, or undefined when the block matches what ploaness ships.
 */
const checkSection = (asset: ManagedAsset, state: AssetState): AssetViolation | undefined => {
  const section: SectionState = readManagedSection(state.actual ?? '')
  // Malformed markers get their own advice on purpose: `ploaness sync` refuses such a file, so telling
  // the project to run it would send it round a loop that cannot terminate.
  if (section.kind === 'malformed') {
    return { path: asset.path, reason: `${section.reason}; repair the markers by hand` }
  }
  if (section.kind === 'absent') {
    return {
      path: asset.path,
      reason: 'the ploaness managed block is missing; run `ploaness sync`',
    }
  }
  return section.block === (state.expected ?? '').trim()
    ? undefined
    : {
        path: asset.path,
        reason: 'the ploaness managed block drifted from the ploaness copy; run `ploaness sync`',
      }
}

/**
 * Judge one managed path against its disposition.
 * @param asset the catalogue entry.
 * @param state the working-tree and shipped content for that path.
 * @returns a violation, or undefined when the path conforms.
 */
export const checkAsset = (asset: ManagedAsset, state: AssetState): AssetViolation | undefined => {
  if (asset.disposition === 'FORBIDDEN') {
    return state.exists
      ? {
          path: asset.path,
          reason:
            'ploaness supplies this configuration, so a working-tree copy shadows it; delete the file',
        }
      : undefined
  }
  if (!state.exists) {
    return { path: asset.path, reason: 'managed file is missing; run `ploaness sync`' }
  }
  if (asset.disposition === 'SEED') {
    return undefined
  }
  if (asset.disposition === 'SECTION') {
    return checkSection(asset, state)
  }
  return state.actual === state.expected
    ? undefined
    : {
        path: asset.path,
        reason: 'managed file drifted from the ploaness copy; run `ploaness sync`',
      }
}

/**
 * Judge every catalogue entry the project has not explicitly taken over.
 * @param assets the parsed catalogue.
 * @param unmanaged repo-relative paths the project owns instead.
 * @param stateOf resolves the working-tree and shipped content for a path.
 * @returns one violation per non-conforming path; empty means the tree matches the catalogue.
 */
export const findAssetViolations = (
  assets: readonly ManagedAsset[],
  unmanaged: readonly string[],
  stateOf: (path: string) => AssetState,
): readonly AssetViolation[] => {
  const owned: ReadonlySet<string> = new Set(unmanaged)
  return assets.flatMap((asset: ManagedAsset): readonly AssetViolation[] => {
    if (owned.has(asset.path)) {
      return []
    }
    const violation: AssetViolation | undefined = checkAsset(asset, stateOf(asset.path))
    return violation === undefined ? [] : [violation]
  })
}

/** What `ploaness sync` should do with one managed path. */
export type SyncAction = 'write' | 'delete' | 'skip' | 'splice'

/**
 * Decide the sync action for one path. A PINNED file is always rewritten, so drift is repaired; a SEED
 * file is written only when absent, so the project's own edits survive; a FORBIDDEN file is deleted; a
 * SECTION file has only its marked block replaced.
 * @param asset the catalogue entry.
 * @param exists whether the path currently exists in the working tree.
 * @returns the action `ploaness sync` performs.
 */
export const syncAction = (asset: ManagedAsset, exists: boolean): SyncAction => {
  if (asset.disposition === 'FORBIDDEN') {
    return exists ? 'delete' : 'skip'
  }
  if (asset.disposition === 'SEED') {
    return exists ? 'skip' : 'write'
  }
  // A SECTION file is never overwritten, even when absent: the project text below the block is the
  // project's, and creating the file wholesale would be ploaness writing that text on its behalf.
  if (asset.disposition === 'SECTION') {
    return 'splice'
  }
  return 'write'
}
