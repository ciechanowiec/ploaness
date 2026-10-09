// Security decisions over the configuration Payload actually resolves, including plugin contributions.
import { isArray, isRecord, readKey } from './json-shapes.js'
import { parsePayloadReport } from './payload-defaults.js'

/** Authentication values observed after Payload has applied its defaults and plugins. */
export interface ResolvedAuth {
  readonly slug: string
  readonly local: boolean
  readonly maxLoginAttempts: unknown
  readonly lockTime: unknown
  readonly tokenExpiration: unknown
}

/** Only the state is reported: an auto-login object can contain credentials. */
export interface PayloadSecurityReport {
  readonly authentication: readonly ResolvedAuth[]
  readonly autoLogin: 'disabled' | 'enabled' | 'invalid'
}

const autoLoginState = (value: unknown): PayloadSecurityReport['autoLogin'] => {
  if (value === undefined || value === false) {
    return 'disabled'
  }
  return isRecord(value) ? 'enabled' : 'invalid'
}

const observedLimit = (auth: unknown, key: string): unknown => readKey(auth, key) ?? null

const hasLocalStrategy = (auth: unknown): boolean => {
  const disabled: unknown = readKey(auth, 'disableLocalStrategy')
  if (disabled === undefined || disabled === false) {
    return true
  }
  if (disabled === true || isRecord(disabled)) {
    return false
  }
  throw new TypeError('resolved auth.disableLocalStrategy is not a supported strategy setting')
}

/** Read security-relevant values without invoking access functions or retaining credentials. */
export const payloadSecurityOf = (config: unknown): PayloadSecurityReport => {
  const collections: unknown = readKey(config, 'collections')
  if (!isArray(collections)) {
    throw new TypeError('the resolved Payload configuration has no collections array')
  }
  return {
    autoLogin: autoLoginState(readKey(readKey(config, 'admin'), 'autoLogin')),
    authentication: collections.flatMap((collection: unknown): readonly ResolvedAuth[] => {
      const auth: unknown = readKey(collection, 'auth')
      if (auth === undefined || auth === false) {
        return []
      }
      const slug: unknown = readKey(collection, 'slug')
      if (typeof slug !== 'string' || !isRecord(auth)) {
        throw new TypeError('an authentication collection has no resolved slug or auth object')
      }
      return [
        {
          slug,
          local: hasLocalStrategy(auth),
          maxLoginAttempts: observedLimit(auth, 'maxLoginAttempts'),
          lockTime: observedLimit(auth, 'lockTime'),
          tokenExpiration: observedLimit(auth, 'tokenExpiration'),
        },
      ]
    }),
  }
}

const isResolvedAuth = (value: unknown): value is ResolvedAuth =>
  isRecord(value) &&
  typeof value['slug'] === 'string' &&
  typeof value['local'] === 'boolean' &&
  ['maxLoginAttempts', 'lockTime', 'tokenExpiration'].every((key: string): boolean => Object.hasOwn(value, key))

/** Missing security evidence is a probe failure, even if the access portion was readable. */
export const parsePayloadSecurityReport = (text: string): PayloadSecurityReport | undefined => {
  const report: unknown = parsePayloadReport(text)
  const authentication: unknown = readKey(report, 'authentication')
  if (!(isArray(authentication) && authentication.every(isResolvedAuth))) {
    return undefined
  }
  const autoLogin: unknown = readKey(report, 'autoLogin')
  return isAutoLoginState(autoLogin) ? { authentication, autoLogin } : undefined
}

const isPositive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0

const isAutoLoginState = (value: unknown): value is PayloadSecurityReport['autoLogin'] =>
  typeof value === 'string' && ['disabled', 'enabled', 'invalid'].includes(value)

const UNITS: Readonly<Record<string, string>> = { lockTime: ' (milliseconds)', tokenExpiration: ' (seconds)' }

const authFindings = (auth: ResolvedAuth): readonly string[] => {
  if (!auth.local) {
    return []
  }
  return ['maxLoginAttempts', 'lockTime', 'tokenExpiration'].flatMap((key: string): readonly string[] => {
    const value: unknown = readKey(auth, key)
    const isValid: boolean = isPositive(value) && (key !== 'maxLoginAttempts' || Number.isSafeInteger(value))
    const requirement: string = key === 'maxLoginAttempts' ? 'a positive integer' : 'a finite positive number'
    const unit: string = UNITS[key] ?? ''
    return isValid
      ? []
      : [`collection "${auth.slug}" resolves auth.${key}${unit} to ${JSON.stringify(value)}; set ${requirement}`]
  })
}

/** Enforce native authentication limits and disable the development login feature in production. */
export const findPayloadSecurityViolations = (report: PayloadSecurityReport): readonly string[] => [
  ...report.authentication.flatMap((auth: ResolvedAuth): readonly string[] => authFindings(auth)),
  ...(report.autoLogin === 'disabled'
    ? []
    : ['production admin.autoLogin must be absent or false; disable auto-login and credential prefill in production']),
]
