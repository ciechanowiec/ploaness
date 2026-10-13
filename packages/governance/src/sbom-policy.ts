// A release inventory is evidence only when its inputs, components and graph are accounted for.
import path from 'node:path'
import { asRecord, asText, isArray, isRecord, readKey } from './json-shapes.js'
import { coordinateOf } from './license-inventory.js'

/** Files whose bytes a release inventory accompanies, and where its two reports are written. */
export interface SbomArguments {
  readonly artifacts: readonly string[]
  readonly output: string
}

const OPTION_PAIR: number = 2

/** Parse the deliberately small release-inventory command grammar. */
export const parseSbomArguments = (arguments_: readonly string[]): SbomArguments | undefined => {
  if (arguments_.length % OPTION_PAIR !== 0) {
    return undefined
  }
  const pairs: readonly (readonly [string | undefined, string | undefined])[] = Array.from(
    { length: arguments_.length / OPTION_PAIR },
    (_, index: number) => [arguments_[index * OPTION_PAIR], arguments_[index * OPTION_PAIR + 1]],
  )
  if (
    pairs.some(
      ([key = '', value]) =>
        !['--artifact', '--output'].includes(key) || value === undefined || value.length === 0 || value.startsWith('-'),
    )
  ) {
    return undefined
  }
  const artifacts: readonly string[] = pairs.filter(([key]) => key === '--artifact').map(([, value = '']) => value)
  const outputs: readonly string[] = pairs.filter(([key]) => key === '--output').map(([, value = '']) => value)
  return artifacts.length === 0 || new Set(artifacts).size !== artifacts.length || outputs.length > 1
    ? undefined
    : { artifacts, output: outputs[0] ?? 'dist/sbom' }
}

/** Stable structural comparison of lockfile documents, independent of YAML key ordering. */
export const canonicalInventory = (value: unknown): string => {
  if (isArray(value)) {
    return `[${value.map((entry: unknown): string => canonicalInventory(entry)).join(',')}]`
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort((left: string, right: string): number => left.localeCompare(right, 'en'))
      .map((key: string): string => `${JSON.stringify(key)}:${canonicalInventory(value[key])}`)
      .join(',')}}`
  }
  return value === undefined ? 'null' : JSON.stringify(value)
}

/** A workspace manifest, addressed the same way as a pnpm lockfile importer. */
export interface SbomManifest {
  readonly path: string
  readonly packageJson: unknown
}

const DEPENDENCY_GROUPS: readonly string[] = ['dependencies', 'devDependencies', 'optionalDependencies']

const FILE_PROTOCOL: string = 'file:'
const isAbsolutePath = (value: string): boolean => path.posix.isAbsolute(value) || path.win32.isAbsolute(value)

// pnpm addresses a relative archive override from the workspace root, but writes each importer's
// specifier relative to that member. Compare their lexical targets without reading the filesystem.
const matchesOverride = (override: unknown, locked: unknown, importer: string): boolean => {
  if (typeof override !== 'string' || !override.startsWith(FILE_PROTOCOL)) {
    return locked === override
  }
  const target: string = override.slice(FILE_PROTOCOL.length)
  if (isAbsolutePath(target)) {
    return locked === override
  }
  if (typeof locked !== 'string' || !locked.startsWith(FILE_PROTOCOL)) {
    return false
  }
  const memberTarget: string = locked.slice(FILE_PROTOCOL.length)
  return (
    !isAbsolutePath(memberTarget) &&
    path.posix.normalize(path.posix.join(importer, memberTarget)) === path.posix.normalize(target)
  )
}

const manifestProblems = (manifest: SbomManifest, lock: unknown): readonly string[] => {
  const importers: unknown = readKey(lock, 'importers')
  const overrides: Record<string, unknown> = asRecord(readKey(lock, 'overrides'))
  const importer: unknown = readKey(importers, manifest.path)
  if (!isRecord(importer)) {
    return [`pnpm-lock.yaml has no importer for ${manifest.path}; install with the pinned pnpm`]
  }
  return DEPENDENCY_GROUPS.flatMap((group: string): readonly string[] => {
    const declared: Record<string, unknown> = asRecord(readKey(manifest.packageJson, group))
    const lockedGroup: Record<string, unknown> = asRecord(readKey(importer, group))
    const names: readonly string[] = [...new Set([...Object.keys(declared), ...Object.keys(lockedGroup)])]
    return names.flatMap((name: string): readonly string[] => {
      const specifier: unknown = declared[name]
      const locked: unknown = lockedGroup[name]
      const override: unknown = overrides[name] ?? overrides[`${name}@${String(specifier)}`]
      const lockedSpecifier: unknown = readKey(locked, 'specifier')
      const isMatched: boolean =
        override === undefined
          ? lockedSpecifier === specifier
          : matchesOverride(override, lockedSpecifier, manifest.path)
      return isMatched && Object.hasOwn(declared, name)
        ? []
        : [`${manifest.path}: ${name} does not match its frozen lockfile specifier; install with the pinned pnpm`]
    })
  })
}

/** Reject a stale install or a manifest-only approximation before invoking the generator. */
export const sbomInputProblems = (
  manifests: readonly SbomManifest[],
  lock: unknown,
  installed: unknown,
  workspace: unknown = {},
): readonly string[] => {
  if (!isRecord(lock) || (String(lock['lockfileVersion']) !== '9.0' && String(lock['lockfileVersion']) !== '9')) {
    return ['SBOM generation requires a supported pnpm lockfile version 9']
  }
  if (!isRecord(installed)) {
    return ['the installed pnpm lock snapshot is missing']
  }
  const isMatched: boolean = ['importers', 'packages', 'snapshots'].every(
    (key: string): boolean => canonicalInventory(readKey(lock, key)) === canonicalInventory(readKey(installed, key)),
  )
  return [
    ...(canonicalInventory(asRecord(readKey(lock, 'overrides'))) ===
    canonicalInventory(asRecord(readKey(workspace, 'overrides')))
      ? []
      : ['workspace overrides differ from the frozen lockfile; install with the pinned pnpm']),
    ...(isMatched ? [] : ['the installed pnpm lock snapshot differs; run pnpm install --frozen-lockfile']),
    ...manifests.flatMap((manifest: SbomManifest): readonly string[] => manifestProblems(manifest, lock)),
  ]
}

const allComponents = (components: readonly unknown[]): readonly unknown[] =>
  components.flatMap((component: unknown): readonly unknown[] => {
    const nested: unknown = readKey(component, 'components')
    return [component, ...(isArray(nested) ? allComponents(nested) : [])]
  })

const graphProblems = (dependencies: readonly unknown[], references: ReadonlySet<string>): readonly string[] =>
  dependencies.flatMap((dependency: unknown): readonly string[] => {
    const reference: unknown = readKey(dependency, 'ref')
    const children: unknown = readKey(dependency, 'dependsOn')
    const isValid: boolean =
      typeof reference === 'string' &&
      references.has(reference) &&
      isArray(children) &&
      children.every((child: unknown): boolean => typeof child === 'string' && references.has(child))
    return isValid ? [] : ['the SBOM contains an invalid dependency reference']
  })

const missingGraphEntries = (dependencies: readonly unknown[], references: ReadonlySet<string>): readonly string[] => {
  const declared: ReadonlySet<unknown> = new Set(dependencies.map((entry: unknown): unknown => readKey(entry, 'ref')))
  return declared.size === dependencies.length &&
    [...references].every((reference: string): boolean => declared.has(reference))
    ? []
    : ['the SBOM does not explicitly account for every component in its dependency graph']
}

/** Preserve declared per-workspace usage without guessing transitive usage from source imports. */
export const sbomWithWorkspaceRoles = (bom: unknown, manifests: readonly SbomManifest[]): unknown => {
  const metadata: Record<string, unknown> = asRecord(readKey(bom, 'metadata'))
  const properties: unknown = metadata['properties']
  const roles: readonly unknown[] = manifests.map((manifest: SbomManifest): unknown => ({
    path: manifest.path,
    dependencies: Object.fromEntries(
      DEPENDENCY_GROUPS.map((group: string): readonly [string, readonly string[]] => [
        group,
        Object.keys(asRecord(readKey(manifest.packageJson, group))),
      ]),
    ),
  }))
  return {
    ...asRecord(bom),
    metadata: {
      ...metadata,
      properties: [
        ...(isArray(properties) ? properties : []),
        { name: 'ploaness:direct-workspace-dependency-roles', value: JSON.stringify(roles) },
      ],
    },
  }
}

// An SPDX expression is ids joined by AND, OR and WITH, optionally grouped. Anything else - `UNLICENSED`,
// `SEE LICENSE IN LICENSE.md`, a free-text name - is recorded as a named licence, so the CycloneDX
// document never claims an expression the declared text is not.
const SPDX_ID: RegExp = /^[A-Za-z0-9][A-Za-z0-9.-]*\+?$/u
const SPDX_SEPARATORS: RegExp = /([()])|\s+/u
const SPDX_OPERATORS: ReadonlySet<string> = new Set(['AND', 'OR', 'WITH'])
const NOT_AN_EXPRESSION: ReadonlySet<string> = new Set(['UNLICENSED', 'UNKNOWN', 'NONE', 'NOASSERTION'])

const isOperand = (part: string): boolean =>
  SPDX_ID.test(part) && !SPDX_OPERATORS.has(part) && !NOT_AN_EXPRESSION.has(part.toUpperCase())

const PAIR: number = 2

const depthChange = (part: string): number => {
  if (part === '(') {
    return 1
  }
  return part === ')' ? -1 : 0
}

// Parentheses must balance, and between them the parts must alternate operand, operator, operand: four
// words in a row are a sentence, not an expression.
const isBalanced = (parts: readonly string[]): boolean => {
  const depths: readonly number[] = parts.reduce(
    (seen: readonly number[], part: string): readonly number[] => [...seen, (seen.at(-1) ?? 0) + depthChange(part)],
    [0],
  )
  return depths.every((depth: number): boolean => depth >= 0) && depths.at(-1) === 0
}

const isSpdxExpression = (license: string): boolean => {
  const parts: readonly string[] = license
    .split(SPDX_SEPARATORS)
    .filter((part?: string): part is string => part !== undefined && part.length > 0)
  const terms: readonly string[] = parts.filter((part: string): boolean => part !== '(' && part !== ')')
  return (
    terms.length % PAIR === 1 &&
    isBalanced(parts) &&
    terms.every((part: string, index: number): boolean =>
      index % PAIR === 0 ? isOperand(part) : SPDX_OPERATORS.has(part),
    )
  )
}

/**
 * The CycloneDX licence choice for one declared licence.
 * @param license the licence the installed package declares.
 * @returns an SPDX expression when the text is one, otherwise a named licence.
 */
export const cycloneLicenseOf = (license: string): readonly unknown[] => {
  const declared: string = license.trim()
  return [isSpdxExpression(declared) ? { expression: declared } : { license: { name: declared } }]
}

const componentCoordinate = (component: unknown): string => {
  const group: string = asText(readKey(component, 'group'))
  const name: string = asText(readKey(component, 'name'))
  return coordinateOf(group.length > 0 ? `${group}/${name}` : name, asText(readKey(component, 'version')))
}

const withDeclaredLicense = (component: unknown, licenses: ReadonlyMap<string, string>): unknown => {
  const nested: unknown = readKey(component, 'components')
  const license: string | undefined = licenses.get(componentCoordinate(component))
  return {
    ...asRecord(component),
    ...(license !== undefined && license.trim().length > 0 && { licenses: cycloneLicenseOf(license) }),
    ...(isArray(nested) && {
      components: nested.map((child: unknown): unknown => withDeclaredLicense(child, licenses)),
    }),
  }
}

/**
 * Record the licence each installed package declares on its SBOM component.
 *
 * The generator runs offline and without the installation, so it cannot read a licence itself. The
 * values come from the same installed manifests the licence gate judges, which keeps the inventory and
 * the verdict on one source; a component the installation does not report keeps whatever it carried.
 * @param bom the generated CycloneDX document.
 * @param licenses the declared licence by `name@version`.
 * @returns the document with the licences recorded.
 */
export const sbomWithDeclaredLicenses = (bom: unknown, licenses: ReadonlyMap<string, string>): unknown => {
  const components: unknown = readKey(bom, 'components')
  return {
    ...asRecord(bom),
    ...(isArray(components) && {
      components: components.map((component: unknown): unknown => withDeclaredLicense(component, licenses)),
    }),
  }
}

interface BomParts {
  readonly components: readonly unknown[]
  readonly dependencies: readonly unknown[]
  readonly root: unknown
}

const bomPartsOf = (bom: unknown): BomParts | undefined => {
  const components: unknown = readKey(bom, 'components')
  const dependencies: unknown = readKey(bom, 'dependencies')
  const root: unknown = readKey(readKey(bom, 'metadata'), 'component')
  if (
    readKey(bom, 'bomFormat') !== 'CycloneDX' ||
    readKey(bom, 'specVersion') !== '1.6' ||
    !isArray(components) ||
    !isArray(dependencies) ||
    !isRecord(root)
  ) {
    return undefined
  }
  return { components, dependencies, root }
}

/** Additional completeness checks after the generator's pinned CycloneDX schema validation. */
export const sbomProblems = (bom: unknown): readonly string[] => {
  const parts: BomParts | undefined = bomPartsOf(bom)
  if (parts === undefined) {
    return ['the generator returned no complete CycloneDX 1.6 inventory']
  }
  const { root, components, dependencies } = parts
  const entries: readonly unknown[] = allComponents([root, ...components])
  const references: readonly unknown[] = entries.map((entry: unknown): unknown => readKey(entry, 'bom-ref'))
  const isValid: boolean = entries.every((entry: unknown): boolean =>
    ['name', 'version', 'bom-ref', 'purl'].every((key: string): boolean => {
      const value: unknown = readKey(entry, key)
      return typeof value === 'string' && value.length > 0
    }),
  )
  const references_: ReadonlySet<string> = new Set(
    references.filter((reference: unknown): reference is string => typeof reference === 'string'),
  )
  const compositions: unknown = readKey(bom, 'compositions')
  return [
    ...(isValid && references_.size === entries.length
      ? []
      : ['the SBOM has missing identities or duplicate component references']),
    ...(dependencies.length === 0
      ? ['the SBOM contains no dependency graph']
      : graphProblems(dependencies, references_)),
    ...missingGraphEntries(dependencies, references_),
    ...(isArray(compositions) &&
    compositions.some((entry: unknown): boolean => readKey(entry, 'aggregate') !== 'complete')
      ? ['the generator reports an incomplete inventory']
      : []),
  ]
}
