// The managed-file gate and the `ploaness sync` implementation. Both read the same catalogue, so the
// gate can never disagree with the command that repairs it.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import {
  type AssetState,
  type AssetViolation,
  applyManagedSection,
  findAssetViolations,
  type ManagedAsset,
  type ParsedManifest,
  parseManifest,
  syncAction,
  type UnmanagedAsset,
} from '@ploaness/governance'
import { type Context, shippedDirectory } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

const assetsRoot = (): string => shippedDirectory('@ploaness/assets')

const readManifestText = (): string => readFileSync(path.join(assetsRoot(), 'manifest.tsv'), 'utf8')

const catalogue = (): ParsedManifest => parseManifest(readManifestText())

// Shipped bodies carry a `.asset` suffix because npm rewrites or strips certain dotfiles when it packs a
// tarball: a shipped `.npmrc` is dropped outright and a shipped `.gitignore` is renamed. Suffixing every
// body keeps the catalogue honest about what a consumer will actually receive.
const bodyPath = (assetPath: string): string =>
  path.join(assetsRoot(), 'files', `${assetPath}.asset`)

const shippedBody = (assetPath: string): string | undefined => {
  const source: string = bodyPath(assetPath)
  return existsSync(source) ? readFileSync(source, 'utf8') : undefined
}

// A PINNED or SEED entry with no shipped body would otherwise be reported as drift in the consumer's
// tree, blaming the project for a ploaness packaging mistake.
const packagingDefects = (assets: readonly ManagedAsset[]): readonly string[] =>
  assets
    .filter(
      (asset: ManagedAsset): boolean =>
        asset.disposition !== 'FORBIDDEN' && !existsSync(bodyPath(asset.path)),
    )
    .map(
      (asset: ManagedAsset): string =>
        `${asset.path}: the catalogue lists it but ploaness ships no body for it`,
    )

const unmanagedPaths = (context: Context): readonly string[] =>
  context.settings.unmanagedAssets.map((entry: UnmanagedAsset): string => entry.path)

const stateOf =
  (root: string) =>
  (assetPath: string): AssetState => {
    const target: string = path.join(root, assetPath)
    const isExists: boolean = existsSync(target)
    // A FORBIDDEN entry may name a directory, so only read a regular file.
    const actual: string | undefined =
      isExists && statSync(target).isFile() ? readFileSync(target, 'utf8') : undefined
    return { isPresent: isExists, actual, expected: shippedBody(assetPath) }
  }

/** Verify the working tree matches the managed-file catalogue. */
export const assets = (context: Context): GateResult => {
  const parsed: ParsedManifest = catalogue()
  if (parsed.problems.length > 0) {
    return failed('the ploaness asset manifest is malformed', parsed.problems)
  }
  const defects: readonly string[] = packagingDefects(parsed.assets)
  if (defects.length > 0) {
    return failed('the ploaness asset catalogue is incomplete', [
      ...defects,
      'this is a ploaness packaging defect; report it',
    ])
  }
  const violations: readonly AssetViolation[] = findAssetViolations(
    parsed.assets,
    unmanagedPaths(context),
    stateOf(context.root),
  )
  return violations.length > 0
    ? failed(
        `${String(violations.length)} managed-file defect(s)`,
        violations.map(
          (violation: AssetViolation): string => `${violation.path}: ${violation.reason}`,
        ),
      )
    : passed(`${String(parsed.assets.length)} managed path(s) match the catalogue`)
}

/**
 * The paths ploaness owns in this working tree, minus any the project has taken over.
 *
 * A gate that measures the project's own code asks for this, because a file the project cannot edit is
 * not the project's to answer for. The managed accessibility sweep carries a scoped lint exemption its
 * crawl needs, and counting that against a consumer's suppression budget would spend a fifth of a small
 * project's allowance on a decision the project did not make and cannot undo.
 * @param context the resolved project environment.
 * @returns every managed path ploaness materialises, as repository-relative paths.
 */
export const managedPaths = (context: Context): ReadonlySet<string> => {
  const owned: ReadonlySet<string> = new Set(unmanagedPaths(context))
  return new Set(
    catalogue()
      .assets.filter(
        (asset: ManagedAsset): boolean =>
          asset.disposition !== 'FORBIDDEN' && !owned.has(asset.path),
      )
      .map((asset: ManagedAsset): string => asset.path),
  )
}

/** One change `ploaness sync` made to the working tree. */
export interface SyncChange {
  readonly path: string
  readonly action: 'wrote' | 'deleted' | 'spliced' | 'refused'
}

const spliceSection = (
  assetPath: string,
  target: string,
  source: string,
): SyncChange | undefined => {
  const current: string = existsSync(target) ? readFileSync(target, 'utf8') : ''
  const spliced: string | undefined = applyManagedSection(
    current,
    readFileSync(source, 'utf8').trim(),
  )
  // Ambiguous markers are the one case sync will not touch: every guess it could make either duplicates
  // the block or swallows text the project owns, and both are worse than stopping.
  if (spliced === undefined) {
    return { path: assetPath, action: 'refused' }
  }
  if (spliced === current) {
    return undefined
  }
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, spliced)
  return { path: assetPath, action: 'spliced' }
}

/** Apply one catalogue entry to the working tree, reporting the change it made. */
const syncOne = (context: Context, asset: ManagedAsset): SyncChange | undefined => {
  const target: string = path.join(context.root, asset.path)
  const action: ReturnType<typeof syncAction> = syncAction(asset, existsSync(target))
  if (action === 'delete') {
    rmSync(target, { recursive: true, force: true })
    return { path: asset.path, action: 'deleted' }
  }
  const source: string = bodyPath(asset.path)
  if (action === 'skip' || !existsSync(source)) {
    return undefined
  }
  if (action === 'splice') {
    return spliceSection(asset.path, target, source)
  }
  mkdirSync(path.dirname(target), { recursive: true })
  cpSync(source, target)
  return { path: asset.path, action: 'wrote' }
}

/**
 * Materialise the managed files into the working tree. This is the only command that writes them: a
 * PINNED file is rewritten so drift is repaired, a SEED file is written only when absent so the
 * project's own edits survive, a FORBIDDEN path is removed, and a SECTION file has only its marked
 * block replaced so the project's own text around it is carried through untouched.
 */
export const syncAssets = (context: Context): readonly SyncChange[] => {
  const owned: ReadonlySet<string> = new Set(unmanagedPaths(context))
  return catalogue()
    .assets.filter((asset: ManagedAsset): boolean => !owned.has(asset.path))
    .map((asset: ManagedAsset): SyncChange | undefined => syncOne(context, asset))
    .filter((change: SyncChange | undefined): change is SyncChange => change !== undefined)
}

/** Write a managed file only when the path is absent, used by `ploaness init`. */
export const hasSeededFile = (context: Context, assetPath: string, body: string): boolean => {
  const target: string = path.join(context.root, assetPath)
  if (existsSync(target)) {
    return false
  }
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, body)
  return true
}
