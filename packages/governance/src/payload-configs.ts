// Share the vocabulary of Payload configuration literals across source-policy checks.

import { COLLECTION_OPERATIONS, GLOBAL_OPERATIONS } from './payload-defaults.js'
import { configBody, depthOneValue } from './payload-source.js'
import {
  balancedArguments,
  type Folded,
  lineOf,
  NOT_FOUND,
  type ScanStep,
  scanDelimited,
} from './source-text.js'

/** The operations one Payload configuration kind must decide explicitly. */
export interface PayloadConfigKind {
  readonly kind: 'collection' | 'global'
  readonly label: string
  readonly operations: readonly string[]
}

/** One Payload configuration literal, with the source position its body begins at. */
export interface FoundPayloadConfig {
  readonly kind: PayloadConfigKind
  readonly body: string
  readonly bodyStart: number
  readonly line: number
}

/** One object written directly as an element of a configuration's `fields` array. */
export interface FoundFieldLiteral {
  readonly body: string
  readonly line: number
}

const declarationPattern = (typeName: string): RegExp =>
  new RegExp(String.raw`(:|satisfies)\s*${typeName}(?=[<=,)\s]|$)`, 'g')

const CONFIG_KINDS: readonly (PayloadConfigKind & { readonly declaration: RegExp })[] = [
  {
    kind: 'collection',
    label: 'CollectionConfig',
    declaration: declarationPattern('CollectionConfig'),
    operations: COLLECTION_OPERATIONS,
  },
  {
    kind: 'global',
    label: 'GlobalConfig',
    declaration: declarationPattern('GlobalConfig'),
    operations: GLOBAL_OPERATIONS,
  },
]

const SATISFIES: string = 'satisfies'

/** A configuration literal: its text, and where that text starts in the file it was read from. */
interface ConfigLiteral {
  readonly body: string
  readonly bodyStart: number
}

// What may stand between a leading type reference and the literal it types. Every form a config is
// really written in puts one of four things there: `= {`, a generic argument and then `= {`, `=> ({`,
// or the opening brace of a function body. Taking "the next brace anywhere after the type name"
// instead crossed statement boundaries and read an unrelated literal further down the file as the
// configuration. A call argument (`= jobsAccess({ ... })`), a parameter annotation
// (`(config: CollectionConfig): void => { ... }`), an interface member and a type-alias member each
// put an identifier, a `)` or a `}` in this gap, and each was judged as though it were a collection -
// so the very code a project writes to GIVE a generated collection its access block was reported as a
// collection with none.
const GOVERNED_BODY: RegExp = /^\s*(?:<[^;{}]*>\s*)?(?:=>?\s*(?:\(\s*)?)?\{/

/** The literal a leading annotation governs, or nothing when the annotation types something else. */
const governedLiteral = (source: string, afterType: number): ConfigLiteral | undefined => {
  const gap: null | RegExpExecArray = GOVERNED_BODY.exec(source.slice(afterType))
  if (gap === null) {
    return undefined
  }
  const bodyStart: number = afterType + gap[0].length - 1
  const inner: string | undefined = balancedArguments(source, bodyStart)
  return inner === undefined ? undefined : { body: `{${inner}}`, bodyStart }
}

/** The literal a trailing `satisfies` types: the one that closed just before it. */
const precedingLiteral = (source: string, marker: number): ConfigLiteral | undefined => {
  const body: string | undefined = configBody(source, marker, true)
  if (body === undefined) {
    return undefined
  }
  const bodyStart: number = source.lastIndexOf(body, marker)
  return bodyStart === NOT_FOUND ? undefined : { body, bodyStart }
}

const configsOfKind = (
  source: string,
  kind: PayloadConfigKind & { readonly declaration: RegExp },
): readonly FoundPayloadConfig[] =>
  [...source.matchAll(kind.declaration)].flatMap(
    (match: RegExpExecArray): readonly FoundPayloadConfig[] => {
      const literal: ConfigLiteral | undefined =
        match[1] === SATISFIES
          ? precedingLiteral(source, match.index)
          : governedLiteral(source, match.index + match[0].length)
      return literal === undefined ? [] : [{ kind, ...literal, line: lineOf(source, match.index) }]
    },
  )

/** Every collection and global configuration literal the source declares. */
export const payloadConfigsIn = (source: string): readonly FoundPayloadConfig[] =>
  CONFIG_KINDS.flatMap(
    (kind: PayloadConfigKind & { readonly declaration: RegExp }): readonly FoundPayloadConfig[] =>
      configsOfKind(source, kind),
  )

/** A direct object element while its closing brace has not yet been visited. */
interface FieldSpan {
  readonly open: number
  readonly close: number
}

const DIRECT_FIELD_DEPTH: number = 2

const closeLastSpan = (spans: readonly FieldSpan[], close: number): readonly FieldSpan[] => {
  const last: FieldSpan | undefined = spans.at(-1)
  return last?.close === NOT_FOUND ? [...spans.slice(0, -1), { open: last.open, close }] : spans
}

const opensDirectField = (step: ScanStep): boolean =>
  step.character === '{' && step.depth === DIRECT_FIELD_DEPTH

const endsDirectField = (step: ScanStep): boolean => step.character === '}' && step.depth === 1

const endsFieldArray = (step: ScanStep): boolean => step.character === ']' && step.depth === 0

const afterFieldDelimiter = (
  spans: readonly FieldSpan[],
  step: ScanStep,
): Folded<readonly FieldSpan[]> => {
  if (opensDirectField(step)) {
    return { state: [...spans, { open: step.index, close: NOT_FOUND }], stop: false }
  }
  if (endsDirectField(step)) {
    return { state: closeLastSpan(spans, step.index), stop: false }
  }
  return { state: spans, stop: endsFieldArray(step) }
}

// Starting on the array opener puts its direct object elements at depth two. A nested object opens at
// depth three or more and is part of the field rather than another field beside it.
const directObjectSpans = (source: string, open: number): readonly FieldSpan[] =>
  scanDelimited<readonly FieldSpan[]>(source, open, afterFieldDelimiter, [])

/** The field literals directly visible in one collection/global config. */
export const directFieldsIn = (
  source: string,
  config: FoundPayloadConfig,
): readonly FoundFieldLiteral[] => {
  const fields: string | undefined = depthOneValue(config.body, 'fields')
  if (fields === undefined) {
    return []
  }
  const open: number = fields.indexOf('[')
  if (open === NOT_FOUND) {
    return []
  }
  const fieldsStart: number = config.bodyStart + config.body.length - fields.length
  return directObjectSpans(fields, open).flatMap(
    (span: FieldSpan): readonly FoundFieldLiteral[] => {
      const body: string | undefined = balancedArguments(fields, span.open)
      return body === undefined
        ? []
        : [{ body: `{${body}}`, line: lineOf(source, fieldsStart + span.open) }]
    },
  )
}
