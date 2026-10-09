// Resolved security policy exercised through the packed CLI and real Payload configuration loader.
import { readFileSync, writeFileSync } from 'node:fs'
import { invoke, requireResult } from './browser-server-support.js'

const EXECUTABLE_ARGUMENT: number = 2
const executable: string | undefined = process.argv[EXECUTABLE_ARGUMENT]
if (executable === undefined) {
  throw new Error('Expected the packed ploaness executable')
}
const usersPath: string = 'src/collections/Users.ts'
const configPath: string = 'src/payload.config.ts'
const users: string = readFileSync(usersPath, 'utf8')
const config: string = readFileSync(configPath, 'utf8')

const requireGate = async (gate: string, code: number, finding: string): Promise<void> => {
  requireResult(await invoke(executable, ['gate', gate]), code, finding)
}

const constantLimits = async (): Promise<void> => {
  writeFileSync('src/lib/auth-limit.ts', 'export const ATTEMPTS: number = 0\n')
  writeFileSync(
    usersPath,
    "import { ATTEMPTS } from '@/lib/auth-limit'\n" +
      users.replace('maxLoginAttempts: 5', 'maxLoginAttempts: ATTEMPTS'),
  )
  await requireGate('payload-rules', 0, '[PASS] payload-rules')
  await requireGate('payload-defaults', 1, 'auth.maxLoginAttempts')
  writeFileSync('src/lib/auth-limit.ts', 'export const ATTEMPTS: number = 5\n')
  await requireGate('payload-defaults', 0, '[PASS] payload-defaults')
  writeFileSync(usersPath, users.replace('maxLoginAttempts: 5', 'maxLoginAttempts: 5, tokenExpiration: 0'))
  await requireGate('payload-defaults', 1, 'auth.tokenExpiration')
  writeFileSync(usersPath, users.replace('maxLoginAttempts: 5', 'disableLocalStrategy: true, maxLoginAttempts: 0'))
  await requireGate('payload-rules', 0, '[PASS] payload-rules')
  await requireGate('payload-defaults', 0, '[PASS] payload-defaults')
  writeFileSync(usersPath, users)
}

const pluginLimits = async (): Promise<void> => {
  const plugin: string = [
    'plugins: [(config) => ({ ...config, collections: config.collections?.map((collection) =>',
    "collection.slug === 'users' ? { ...collection, auth: { ...collection.auth, lockTime: 0 } } : collection) })],",
  ].join('\n')
  writeFileSync(
    configPath,
    config.replace('globals: [Header],', (): string => `globals: [Header],\n${plugin}`),
  )
  await requireGate('payload-defaults', 1, 'auth.lockTime')
}

const autoLoginContracts = async (): Promise<void> => {
  for (const value of [
    "{ email: 'fixture@example.invalid' }",
    "{ email: 'fixture@example.invalid', prefillOnly: true }",
    "process.env.NODE_ENV === 'production' ? { email: 'fixture@example.invalid' } : false",
  ]) {
    writeFileSync(
      configPath,
      config.replace('admin: { user: Users.slug }', (): string => `admin: { user: Users.slug, autoLogin: ${value} }`),
    )
    await requireGate('payload-defaults', 1, 'production admin.autoLogin')
  }
  const onlyDevelopment: string =
    "process.env.NODE_ENV === 'development' ? { email: 'fixture@example.invalid' } : false"
  writeFileSync(
    configPath,
    config.replace(
      'admin: { user: Users.slug }',
      (): string => `admin: { user: Users.slug, autoLogin: ${onlyDevelopment} }`,
    ),
  )
  await requireGate('payload-defaults', 0, '[PASS] payload-defaults')
}

try {
  await constantLimits()
  await pluginLimits()
  await autoLoginContracts()
  console.info('resolved authentication and production auto-login contracts passed')
} finally {
  writeFileSync(usersPath, users)
  writeFileSync(configPath, config)
}
