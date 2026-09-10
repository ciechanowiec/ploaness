// Security defects visible from source syntax alone, independent of Payload configuration.
//
// The rules here reject the shape of a fail-open credential guard rather than guessing whether a route
// is called cron, webhook, or callback. The same defect has two spellings, and each is invisible to the
// other's rule. A bare credential on the left of `&&` makes the rejection on the right disappear
// precisely when configuration is absent. Its mirror tests for absence and then ADMITS the caller, so
// the endpoint opens exactly when the credential is unset. The safe shape is the same in every context:
// reject absence first, then compare the supplied credential.
import type { PayloadViolation } from './payload-source.js'
import {
  balancedArguments,
  type Folded,
  lineOf,
  maskLiterals,
  type ScanStep,
  scanDelimited,
} from './source-text.js'

const GUARDED_IF: RegExp = /\bif\s*\(\s*([a-z_$][\w$]*(?:\s*\.\s*[a-z_$][\w$]*)*)\s*&&/gi

const PENULTIMATE: number = -2

const credentialSegments = (name: string): readonly string[] =>
  name
    .split('.')
    .at(-1)
    ?.replaceAll(/([a-z\d])([A-Z])/g, '$1 $2')
    .split(/[^a-z\d]+/i)
    .filter((segment: string): boolean => segment.length > 0)
    .map((segment: string): string => segment.toLowerCase()) ?? []

const isCredential = (name: string): boolean => {
  const segments: readonly string[] = credentialSegments(name)
  const last: string | undefined = segments.at(-1)
  const previous: string | undefined = segments.at(PENULTIMATE)
  return last === 'secret' || last === 'token' || (previous === 'api' && last === 'key')
}

const conditionClose = (masked: string, open: number): number | undefined => {
  const condition: string | undefined = balancedArguments(masked, open)
  return condition === undefined ? undefined : open + condition.length + 1
}

const statementAt = (masked: string, start: number): string => {
  if (masked[start] === '{') {
    return balancedArguments(masked, start) ?? ''
  }
  const newline: number = masked.indexOf('\n', start)
  return masked.slice(start, newline === -1 ? masked.length : newline)
}

const hasRejectionAfter = (masked: string, close: number): boolean => {
  const statementStart: number = masked.slice(close + 1).search(/\S/)
  if (statementStart < 0) {
    return false
  }
  const start: number = close + 1 + statementStart
  const statement: string = statementAt(masked, start)
  return /\b(?:return|throw)\b/.test(statement)
}

/** Report credential guards whose rejection disappears when the credential is absent. */
export const findFailOpenSecretGuards = (source: string): readonly PayloadViolation[] => {
  const masked: string = maskLiterals(source)
  return [...masked.matchAll(GUARDED_IF)].flatMap(
    (match: RegExpExecArray): readonly PayloadViolation[] => {
      const credential: string = (match[1] ?? '').replaceAll(/\s/g, '')
      const open: number = masked.indexOf('(', match.index)
      const close: number | undefined = conditionClose(masked, open)
      return close !== undefined && isCredential(credential) && hasRejectionAfter(masked, close)
        ? [
            {
              line: lineOf(source, match.index),
              rule: 'no-fail-open-secret-guard',
              reason:
                `reject a missing ${credential} before comparing it; guarded by its own truthiness, ` +
                'the rejection is skipped when the credential is absent',
            },
          ]
        : []
    },
  )
}

const IF_STATEMENT: RegExp = /\bif\s*\(/g

// An operator is top level when no bracket is open at it, which is what separates `a || (b && c)` -
// two disjuncts - from `(a || b) && c`, a conjunction. Both characters of the operator are found at
// the first, because the scan asks whether the operator STARTS here.
const OPERATOR_WIDTH: number = 2

const topLevelOperators = (condition: string, operator: string): readonly number[] =>
  scanDelimited<readonly number[]>(
    condition,
    0,
    (found: readonly number[], step: ScanStep): Folded<readonly number[]> => ({
      state:
        step.depth === 0 && condition.startsWith(operator, step.index)
          ? [...found, step.index]
          : found,
      stop: false,
    }),
    [],
  )

const splitTopLevel = (condition: string, operator: string): readonly string[] => {
  const cuts: readonly number[] = topLevelOperators(condition, operator)
  const ends: readonly number[] = [...cuts, condition.length]
  return [0, ...cuts.map((cut: number): number => cut + OPERATOR_WIDTH)].map(
    (start: number, position: number): string =>
      condition.slice(start, ends[position] ?? condition.length).trim(),
  )
}

// The ways a value is tested for absence. `=== ''` is deliberately absent: `maskLiterals` fills a
// string literal INCLUDING its quotes, so an empty string is indistinguishable from an identifier by
// the time this reads the text. `.length === 0` expresses the same test and survives masking.
const ABSENCE_SHAPES: readonly RegExp[] = [
  /^!\s*([\w$]+(?:\s*\??\.\s*[\w$]+)*)$/,
  /^([\w$]+(?:\s*\??\.\s*[\w$]+)*)\s*===?\s*(?:undefined|null)$/,
  /^([\w$]+(?:\s*\??\.\s*[\w$]+)*)\s*\.\s*length\s*===?\s*0$/,
]

const absentNameIn = (disjunct: string): string | undefined => {
  const matched: RegExpExecArray | undefined = ABSENCE_SHAPES.map(
    (shape: RegExp): RegExpExecArray | null => shape.exec(disjunct),
  ).find((found: RegExpExecArray | null): found is RegExpExecArray => found !== null)
  return matched?.[1]?.replaceAll(/\s/g, '').replaceAll('?.', '.')
}

// The credential a condition admits on absence, or nothing when the condition is not that shape.
//
// A conjunction is refused outright: `if (secret === undefined && enabled)` narrows the branch to a
// case the project chose, and it is the fail-closed shape the sibling rule's tests already pin. Every
// disjunct must be an absence test, which is the conservative reading - `if (!secret || isDevelopment)`
// is fail-open too, but it is not PROVABLY this defect from text, and a false positive here costs more
// than the finding is worth.
const acceptedAbsence = (condition: string): string | undefined => {
  if (topLevelOperators(condition, '&&').length > 0) {
    return undefined
  }
  const names: readonly (string | undefined)[] = splitTopLevel(condition, '||').map(
    (disjunct: string): string | undefined => absentNameIn(disjunct),
  )
  if (names.includes(undefined)) {
    return undefined
  }
  return names.find(
    (name: string | undefined): name is string => name !== undefined && isCredential(name),
  )
}

// The returned VALUE decides, not the presence of a return: `if (!secret) { return unauthorized() }`
// refuses the caller and is correct, while `return true` admits them. `true` is not a string literal,
// so it survives masking intact and can be recognised here.
const ACCEPTANCE: RegExp = /\breturn\s+true\b/

const hasAcceptanceAfter = (masked: string, close: number): boolean => {
  const statementStart: number = masked.slice(close + 1).search(/\S/)
  if (statementStart < 0) {
    return false
  }
  return ACCEPTANCE.test(statementAt(masked, close + 1 + statementStart))
}

/**
 * Report guards that admit the caller when the credential is absent.
 *
 * The mirror of {@link findFailOpenSecretGuards}: that rule reads a rejection guarded by the
 * credential's own truthiness, this one an acceptance guarded by its absence. The two never report the
 * same line, because one requires a top-level `&&` in the condition and the other refuses it.
 * @param source the file's text.
 * @returns one violation per guard that opens on a missing credential.
 */
export const findAbsentSecretAcceptances = (source: string): readonly PayloadViolation[] => {
  const masked: string = maskLiterals(source)
  return [...masked.matchAll(IF_STATEMENT)].flatMap(
    (match: RegExpExecArray): readonly PayloadViolation[] => {
      const open: number = masked.indexOf('(', match.index)
      const condition: string | undefined = balancedArguments(masked, open)
      if (condition === undefined) {
        return []
      }
      const credential: string | undefined = acceptedAbsence(condition)
      return credential !== undefined && hasAcceptanceAfter(masked, open + condition.length + 1)
        ? [
            {
              line: lineOf(source, match.index),
              rule: 'no-absent-secret-acceptance',
              reason:
                `refuse the caller when ${credential} is absent; this admits them instead, so the ` +
                'endpoint is open exactly when the credential is unset and no request is ever ' +
                'refused - reject the absence and report the misconfiguration',
            },
          ]
        : []
    },
  )
}
