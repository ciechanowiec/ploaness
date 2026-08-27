// The joint between two lists that are maintained apart and must agree: the catalogue of files
// ploaness WRITES into a consumer, and the set of files a consumer's coverage report MEASURES.
//
// An asset in both is a file the project did not author and cannot be asked to answer for. It reaches
// every consumer at once, on the first run, as a coverage failure against a file whose only author is
// the harness reporting it - and the only answer available to a project is to restate an exclusion in
// its own manifest, which is the same literal written once per consumer instead of once here.
//
// `src/proxy.ts` is the entry that forced this. It is asserted by name at the end, but the property is
// the point: a seeded `.ts` asset added later lands inside COVERAGE_INCLUDE without anybody noticing,
// and this fails when it does.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type ManagedAsset, type ParsedManifest, parseManifest } from '../src/asset-policy.js'
import { matchesGlob } from '../src/file-roles.js'
import { COVERAGE_INCLUDE, readSettings, type Settings } from '../src/settings.js'

const specDirectory: string = path.dirname(fileURLToPath(import.meta.url))

// The shipped catalogue itself, not a fixture. A fixture would let the two lists drift apart while
// this spec went on passing against a manifest nobody installs.
const MANIFEST: string = readFileSync(
  path.join(specDirectory, '..', '..', 'assets', 'manifest.tsv'),
  'utf8',
)

// The defaults a project inherits before it declares anything of its own. A project's own additions
// are irrelevant here: this asks what ploaness demands of a consumer that declared nothing.
const DEFAULTS: Settings = readSettings({})

// A disposition ploaness writes content for. FORBIDDEN names a path that must NOT exist, SECTION and
// REFERENCE describe a block inside a file the project owns, so none of the three puts an unauthored
// source file in the tree.
const WRITTEN: ReadonlySet<string> = new Set<string>(['PINNED', 'SEED'])

const isMeasured = (filePath: string): boolean =>
  COVERAGE_INCLUDE.some((pattern: string): boolean => matchesGlob(pattern, filePath))

const isExcluded = (filePath: string): boolean =>
  DEFAULTS.coverageExclude.some((pattern: string): boolean => matchesGlob(pattern, filePath))

const parsed: ParsedManifest = parseManifest(MANIFEST)

const writtenAssets: readonly ManagedAsset[] = parsed.assets.filter(
  (asset: ManagedAsset): boolean => WRITTEN.has(asset.disposition),
)

describe('an asset ploaness writes into a consumer', () => {
  // Guards every assertion below: a manifest this could not read would make each of them vacuous, and
  // a spec that measures nothing reports the same green as one that measures everything.
  it('is read from the shipped manifest, which parses without a malformed row', () => {
    expect(parsed.problems).toEqual([])
    expect(writtenAssets.length).toBeGreaterThan(0)
  })

  it('is never left inside the set a consumer coverage report measures', () => {
    const unanswered: readonly string[] = writtenAssets
      .map((asset: ManagedAsset): string => asset.path)
      .filter((filePath: string): boolean => isMeasured(filePath) && !isExcluded(filePath))
    expect(unanswered).toEqual([])
  })

  // The instance, kept beside the property so a reader can see which file the rule was written for.
  // Asserting the property alone would pass just as well with the entry deleted and no asset seeded.
  it('covers src/proxy.ts, the seeded file the rule was written for', () => {
    expect(isMeasured('src/proxy.ts')).toBe(true)
    expect(isExcluded('src/proxy.ts')).toBe(true)
  })
})
