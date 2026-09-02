// Security defects visible from source syntax alone, independent of Payload configuration.
//
// The rule here rejects the shape of a fail-open credential guard rather than guessing whether a route
// is called cron, webhook, or callback. A bare credential on the left of `&&` makes the rejection on
// the right disappear precisely when configuration is absent. The safe shape is the same in every
// context: reject absence first, then compare the supplied credential.
import type { PayloadViolation } from './payload-source.js'
import { balancedArguments, lineOf, maskLiterals } from './source-text.js'

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
