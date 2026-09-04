// The one module that reads `process.env`: every other module consumes the typed values it returns.

/** The validated environment the configuration boots with. */
export interface Environment {
  readonly payloadSecret: string
  readonly databaseUrl: string
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>

const required = (source: EnvironmentSource, name: string): string => {
  const value: string | undefined = source[name]
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required and was not set`)
  }
  return value
}

/**
 * Read and validate the environment from a plain record, which is what keeps the rule testable.
 * @param source - the raw variables, normally `process.env`.
 * @returns the narrowed values.
 */
export const parseEnvironment = (source: EnvironmentSource): Environment => {
  const payloadSecret: string = required(source, 'PAYLOAD_SECRET')
  const databaseUrl: string = required(source, 'DATABASE_URL')
  return { payloadSecret, databaseUrl }
}

/**
 * Read and validate the process environment, failing fast on a missing variable.
 * @returns the narrowed values.
 */
export const loadEnvironment = (): Environment =>
  parseEnvironment({
    PAYLOAD_SECRET: process.env['PAYLOAD_SECRET'],
    DATABASE_URL: process.env['DATABASE_URL'],
  })
