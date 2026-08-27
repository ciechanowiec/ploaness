// Paired-asset policy. Seven files exist twice in this repository: once at the root, where git, the
// editors, and the agents that work on ploaness itself read them, and once as an `.asset` body under
// `packages/assets/files/`, which is what a consumer receives. Nothing but discipline kept the two
// copies equal, and discipline lost: the guideline body was written at the first commit and never
// touched again while the root file was rewritten twice, so every consumer was pinned to a stale
// contract that no gate could see.
//
// The pairing is DERIVED from the manifest rather than restated beside it. Every PINNED or SEED entry
// is paired by default, and a path ploaness authors directly as an asset must say so here. Adding a
// managed dotfile therefore joins the pairing automatically; forgetting to pair it is the failure this
// module exists to prevent, so it cannot be the default.
import type { ManagedAsset } from './asset-policy.js'

/** Where an `.asset` body lives inside the assets package, relative to that package's root. */
const ASSET_DIRECTORY: string = 'files'

/** The suffix npm forces on a packed body: a packed `.npmrc` is stripped and a `.gitignore` renamed. */
const ASSET_SUFFIX: string = '.asset'

// Some paths are authored where they are shipped rather than copied from a root file, all because
// ploaness is not a consumer of itself.
//
// `.ploaness/agent-guide.md` maps the guideline onto the harness for a consumer, and ploaness has no
// `.ploaness/` directory. `.dockerignore` bounds what a Docker build sends to the daemon, and ploaness
// builds no image, so a copy at this root would be a file no tool here reads. The managed sweeps under
// `tests/e2e` drive a Payload application, and ploaness is a library with no application to drive;
// pairing one with a root file would mean keeping a Next.js project in this repository for a spec to
// compile against. What proves those bodies instead is the third verification leg AGENTS.md already
// requires: a real consumer runs them.
//
// `src/proxy.ts` is the security-header baseline, and it is authored here for the same reason as the
// sweeps: it is Next middleware, and there is no Next application in this repository for a root copy of
// it to compile against.
//
// A SECTION entry is likewise unpaired: its body is the managed block, not a copy of any whole file.
const ASSET_AUTHORED_PATHS: ReadonlySet<string> = new Set<string>([
  '.ploaness/agent-guide.md',
  '.dockerignore',
  'tests/e2e/a11y.e2e.spec.ts',
  'tests/e2e/security-headers.e2e.spec.ts',
  'tests/e2e/access-boundary.e2e.spec.ts',
  'src/proxy.ts',
])

/** A root file and the shipped body generated from it. */
export interface PairedAsset {
  /** The path in the ploaness repository, which is the editable source. */
  readonly rootPath: string
  /** The generated body, relative to the assets package root. */
  readonly assetPath: string
}

/** The contents of both sides of one pair, read by the caller so this module stays pure. */
export interface PairedAssetState {
  readonly pair: PairedAsset
  /** The root file's content, or undefined when the root file is missing. */
  readonly rootContent: string | undefined
  /** The generated body's content, or undefined when the body is missing. */
  readonly assetContent: string | undefined
}

/** A pair whose two sides no longer agree. */
export interface PairedAssetDrift {
  readonly rootPath: string
  readonly reason: string
}

/**
 * Derive the root-to-body pairs from the manifest catalogue.
 * @param assets the parsed manifest entries.
 * @returns one pair per PINNED or SEED entry that ploaness generates from a root file.
 */
export const pairedAssets = (assets: readonly ManagedAsset[]): readonly PairedAsset[] =>
  assets
    .filter(
      (asset: ManagedAsset): boolean =>
        (asset.disposition === 'PINNED' || asset.disposition === 'SEED') &&
        !ASSET_AUTHORED_PATHS.has(asset.path),
    )
    .map(
      (asset: ManagedAsset): PairedAsset => ({
        rootPath: asset.path,
        assetPath: `${ASSET_DIRECTORY}/${asset.path}${ASSET_SUFFIX}`,
      }),
    )

const driftReason = (state: PairedAssetState): string | undefined => {
  if (state.rootContent === undefined) {
    return (
      `no root file to generate ${state.pair.assetPath} from; add it, or declare ` +
      'the path as authored directly as an asset'
    )
  }
  if (state.assetContent === undefined) {
    return `${state.pair.assetPath} is missing; regenerate it with \`pnpm run build\``
  }
  return state.rootContent === state.assetContent
    ? undefined
    : `${state.pair.assetPath} no longer matches ${state.pair.rootPath}; consumers would ` +
        'receive stale content. Regenerate it with `pnpm run build`'
}

/**
 * Report every pair whose generated body has drifted from its root file.
 * @param states both sides of every pair, already read.
 * @returns one drift per disagreeing pair; empty means every consumer receives what this repository holds.
 */
export const findPairedAssetDrift = (
  states: readonly PairedAssetState[],
): readonly PairedAssetDrift[] =>
  states.flatMap((state: PairedAssetState): readonly PairedAssetDrift[] => {
    const reason: string | undefined = driftReason(state)
    return reason === undefined ? [] : [{ rootPath: state.pair.rootPath, reason }]
  })
