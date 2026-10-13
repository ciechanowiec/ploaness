// The licence inventory pnpm reports for the resolved set, read into one shape every consumer shares.
import { asRecord, asText, isArray, isRecord, parseJsonc } from './json-shapes.js'

/** One package of the resolved set as the licence inventory reports it. */
export interface InventoryPackage {
  readonly name: string
  /** Every installed version. A directory dependency has none, because pnpm reports its version as null. */
  readonly versions: readonly string[]
  readonly license: string
  /** The installed package directories, where the licence files the package ships are found. */
  readonly paths: readonly string[]
  readonly homepage: string | undefined
}

const strings = (raw: unknown): readonly string[] =>
  isArray(raw) ? raw.filter((entry: unknown): entry is string => typeof entry === 'string') : []

const asInventoryPackage = (raw: unknown, group: string): InventoryPackage => {
  const entry: Record<string, unknown> = asRecord(raw)
  const homepage: string = asText(entry['homepage'])
  // The group key is the licence pnpm grouped the entry under; the entry repeats it, and the entry wins
  // when both are present because it is the value read from the package itself.
  const license: string = asText(entry['license'])
  return {
    name: asText(entry['name']),
    versions: strings(entry['versions']),
    license: license.length > 0 ? license : group,
    paths: strings(entry['paths']),
    homepage: homepage.length > 0 ? homepage : undefined,
  }
}

/**
 * Read the stdout of `pnpm licenses list --json`: packages grouped by their declared licence.
 * @param json the command's stdout.
 * @returns every reported package, or undefined when the text is not that inventory.
 */
export const parseLicenseInventory = (json: string): readonly InventoryPackage[] | undefined => {
  const inventory: unknown = parseJsonc(json).value
  if (!isRecord(inventory) || isArray(inventory)) {
    return undefined
  }
  return Object.entries(inventory).flatMap(
    ([group, entries]: readonly [string, unknown]): readonly InventoryPackage[] =>
      (isArray(entries) ? entries : []).map((entry: unknown): InventoryPackage => asInventoryPackage(entry, group)),
  )
}

/** The coordinate a package version is identified by across the inventory, the SBOM and the report. */
export const coordinateOf = (name: string, version: string): string => `${name}@${version}`

/**
 * Index the declared licence of every installed package version.
 * @param packages the parsed inventory.
 * @returns the licence by `name@version`; a directory dependency without a version is absent.
 */
export const licensesByCoordinate = (packages: readonly InventoryPackage[]): ReadonlyMap<string, string> =>
  new Map(
    packages.flatMap((entry: InventoryPackage): readonly (readonly [string, string])[] =>
      entry.versions.map((version: string): readonly [string, string] => [
        coordinateOf(entry.name, version),
        entry.license,
      ]),
    ),
  )
