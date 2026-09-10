// Which providers an OpenTofu or Terraform source declares, read from block headers alone.
//
// The resource type is the key, because it is what the analyzer's own catalogue binds a check to:
// `aws_iam_role` belongs to `aws` whatever local name a `required_providers` block gives the provider.
// That block is deliberately not read. Modules inherit it from their caller, so it sits in a minority
// of files; its `source = "..."` line cannot be told from a module's without block parsing; and a
// provider declared there with no resource in the tree leaves the analyzer nothing to judge anyway.
// Nothing here parses HCL structure - this stays a line reader, like the policy beside it.
import { lineOf, stripComments } from './source-text.js'

/** One line that names a provider: a resource, a data source, or a provider block. */
export interface ProviderDeclaration {
  readonly line: number
  readonly provider: string
  /** What the line declares, as a finding names it: the resource type, or `provider "name"`. */
  readonly subject: string
  readonly kind: 'resource' | 'data' | 'provider'
}

// Anchored at the start of a line so HCL's own `#` comment, which `stripComments` does not read, cannot
// match; a `//` or `/* */` comment is blanked before the scan (see terraform-policy.ts).
const RESOURCE_HEADER: RegExp = /^[ \t]*(?<kind>resource|data)[ \t]+"(?<type>[a-z][a-z0-9_]*)"/gm
const PROVIDER_HEADER: RegExp = /^[ \t]*provider[ \t]+"(?<name>[a-z][a-z0-9-]*)"/gm

// A provider whose resources carry another provider's prefix. `google-beta` declares `google_*`
// resources, so its block names the provider the resource types already name.
const PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([['google-beta', 'google']])

const providerOfType = (type: string): string => {
  const separator: number = type.indexOf('_')
  return separator === -1 ? type : type.slice(0, separator)
}

// A matched header always carries its groups; the fallback satisfies the type checker, not a case.
const groupOf = (found: RegExpExecArray, group: number): string => found[group] ?? ''

const KIND_GROUP: number = 1
const TYPE_GROUP: number = 2
const NAME_GROUP: number = 1

const resourceDeclarations = (code: string): readonly ProviderDeclaration[] =>
  [...code.matchAll(RESOURCE_HEADER)].map((found: RegExpExecArray): ProviderDeclaration => {
    const type: string = groupOf(found, TYPE_GROUP)
    return {
      line: lineOf(code, found.index),
      provider: providerOfType(type),
      subject: type,
      kind: groupOf(found, KIND_GROUP) === 'data' ? 'data' : 'resource',
    }
  })

const providerBlocks = (code: string): readonly ProviderDeclaration[] =>
  [...code.matchAll(PROVIDER_HEADER)].map((found: RegExpExecArray): ProviderDeclaration => {
    const name: string = groupOf(found, NAME_GROUP)
    return {
      line: lineOf(code, found.index),
      provider: PROVIDER_ALIASES.get(name) ?? name,
      subject: `provider "${name}"`,
      kind: 'provider',
    }
  })

/**
 * Every line of a source that names a provider.
 * @param source the file's text, as tracked.
 * @returns the declarations, ordered by the line they sit on.
 */
export const providerDeclarationsIn = (source: string): readonly ProviderDeclaration[] => {
  const code: string = stripComments(source)
  return [...resourceDeclarations(code), ...providerBlocks(code)].toSorted(
    (left: ProviderDeclaration, right: ProviderDeclaration): number => left.line - right.line,
  )
}

/**
 * The providers a set of declarations names.
 * @param declarations declarations from one or many sources.
 * @returns each provider once, ordered so a report reads the same on every machine.
 */
export const providersOf = (declarations: readonly ProviderDeclaration[]): readonly string[] =>
  [
    ...new Set(
      declarations.map((declaration: ProviderDeclaration): string => declaration.provider),
    ),
  ].toSorted((left: string, right: string): number => left.localeCompare(right))

/**
 * How many resources and data sources the declarations carry - what an analyzer has to judge. A
 * provider block configures a provider and declares nothing it could check.
 * @param declarations declarations from one or many sources.
 * @returns the count of resource and data declarations.
 */
export const resourceCountOf = (declarations: readonly ProviderDeclaration[]): number =>
  declarations.filter(
    (declaration: ProviderDeclaration): boolean => declaration.kind !== 'provider',
  ).length
