// Output-safety rules have two joints to prove: the selectors reject the raw values they describe, and
// every composed flat config still carries them after its role-specific blocks replace
// `no-restricted-syntax`. A source-text assertion would prove neither.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint, Linter, type Linter as LinterTypes } from 'eslint'
import { describe, expect, it } from 'vitest'
import payloadConfig from '../dist/eslint.js'
import libraryConfig from '../dist/eslint-library.js'
import { SECURITY_RESTRICTIONS } from '../src/eslint-security.js'

type LintMessage = ReturnType<Linter['verify']>[number]

const linter: Linter = new Linter()

const lint = (code: string): readonly LintMessage[] =>
  linter.verify(code, {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: { 'no-restricted-syntax': ['error', ...SECURITY_RESTRICTIONS] },
  })

const messagesContaining = (code: string, marker: string): readonly LintMessage[] =>
  lint(code).filter((message: LintMessage): boolean => message.message.includes(marker))

const TEMPLATE_LOG: string = ['console.log(`credential=', '$', '{secret}`)'].join('')

describe('sensitive-data-logged', () => {
  it.each([
    'console.info(token)',
    'console.warn(user.password)',
    'console.error({ apiKey })',
    TEMPLATE_LOG,
    "console.debug('token=' + auth.token)",
    'console.trace({ password: user.password })',
  ])('rejects a raw sensitive value in %s', (code: string) => {
    expect(messagesContaining(code, 'sensitive-data-logged').length).toBeGreaterThan(0)
  })

  it('accepts an explicit redaction boundary', () => {
    expect(messagesContaining('console.info(redact(user.token))', 'sensitive-data-logged')).toEqual(
      [],
    )
  })

  it('accepts a literal already marked as redacted', () => {
    expect(
      messagesContaining("console.info({ token: '[redacted]' })", 'sensitive-data-logged'),
    ).toEqual([])
  })

  it('does not mistake a non-sensitive member for a credential', () => {
    expect(messagesContaining('console.info(user.displayName)', 'sensitive-data-logged')).toEqual(
      [],
    )
  })
})

describe('leaks-error-message', () => {
  it.each([
    'Response.json({ error: error.message })',
    "NextResponse.json({ 'message': err.stack })",
    'Response.json(exception.message)',
    'function endpoint() { return { error: error.message } }',
    'const endpoint = () => ({ message: exception.stack })',
    'new Response(err.message)',
  ])('rejects an internal error value in %s', (code: string) => {
    expect(messagesContaining(code, 'leaks-error-message').length).toBeGreaterThan(0)
  })

  it('accepts a generic public response message', () => {
    expect(
      messagesContaining(
        "Response.json({ error: 'Internal server error' })",
        'leaks-error-message',
      ),
    ).toEqual([])
  })

  it('accepts an explicit public-message boundary', () => {
    expect(
      messagesContaining('Response.json({ error: publicError(error) })', 'leaks-error-message'),
    ).toEqual([])
  })

  it('does not mistake a domain message for an internal error object', () => {
    expect(
      messagesContaining('Response.json({ message: article.message })', 'leaks-error-message'),
    ).toEqual([])
  })
})

const configPackage: string = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

const selectorsFor = async (
  config: readonly LinterTypes.Config[],
  filePath: string,
): Promise<readonly string[]> => {
  const eslint: ESLint = new ESLint({
    overrideConfigFile: true,
    baseConfig: [...config],
    cwd: configPackage,
  })
  const resolved: unknown = await eslint.calculateConfigForFile(filePath)
  const rules: unknown = isRecord(resolved) ? resolved['rules'] : undefined
  const setting: unknown = isRecord(rules) ? rules['no-restricted-syntax'] : undefined
  if (!Array.isArray(setting)) {
    throw new TypeError(`no-restricted-syntax resolved to nothing for ${filePath}`)
  }
  return setting.slice(1).flatMap((entry: unknown): readonly string[] => {
    const selector: unknown = isRecord(entry) ? entry['selector'] : undefined
    return typeof selector === 'string' ? [selector] : []
  })
}

const CONFIG_CASES: readonly (readonly [string, readonly LinterTypes.Config[], string])[] = [
  ['Payload production', payloadConfig, 'src/lib/example.ts'],
  ['Payload collection', payloadConfig, 'src/collections/Users.ts'],
  ['Payload unit test', payloadConfig, 'tests/unit/example.spec.ts'],
  ['Payload end-to-end test', payloadConfig, 'tests/e2e/example.spec.ts'],
  ['library production', libraryConfig, 'src/example.ts'],
  ['library test', libraryConfig, 'tests/unit/example.spec.ts'],
]

describe('the security selectors survive each flat-config cascade', { timeout: 30_000 }, () => {
  it.each(CONFIG_CASES)('remain active in %s', async (_label, config, filePath) => {
    const resolved: readonly string[] = await selectorsFor(config, filePath)
    for (const restriction of SECURITY_RESTRICTIONS) {
      expect(resolved, restriction.selector).toContain(restriction.selector)
    }
  })
})
