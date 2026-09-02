// The shared catalogue of Payload configuration literals.
//
// Access policy and field policy ask different questions of the same object: whether a collection or
// global has declared its operation boundary, and whether a privilege-bearing field has declared its
// own. The declaration forms must therefore have one owner. A second regex beside the access rule was
// how generic annotations and `satisfies` configurations previously escaped every Payload check.
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
  readonly marker: number
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
    operations: ['create', 'read', 'update', 'delete'],
  },
  {
    kind: 'global',
    label: 'GlobalConfig',
    declaration: declarationPattern('GlobalConfig'),
    operations: ['read', 'update'],
  },
]

const SATISFIES: string = 'satisfies'

const bodyStartOf = (source: string, body: string, marker: number, isTrailing: boolean): number =>
  isTrailing ? source.lastIndexOf(body, marker) : source.indexOf(body, marker)

const configsOfKind = (
  source: string,
  kind: PayloadConfigKind & { readonly declaration: RegExp },
): readonly FoundPayloadConfig[] =>
  [...source.matchAll(kind.declaration)].flatMap(
    (match: RegExpExecArray): readonly FoundPayloadConfig[] => {
      const isTrailing: boolean = match[1] === SATISFIES
      const body: string | undefined = configBody(source, match.index, isTrailing)
      if (body === undefined) {
        return []
      }
      const bodyStart: number = bodyStartOf(source, body, match.index, isTrailing)
      return bodyStart === NOT_FOUND
        ? []
        : [{ kind, marker: match.index, body, bodyStart, line: lineOf(source, match.index) }]
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
