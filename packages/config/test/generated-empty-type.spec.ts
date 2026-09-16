import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ESLint, type Linter } from 'eslint'
import { afterAll, describe, expect, it } from 'vitest'
import payloadConfig from '../dist/eslint.js'
import libraryConfig from '../dist/eslint-library.js'

const RULE: string = '@typescript-eslint/no-generated-empty-object-type'
const workspaceRoot: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const workspaceModule: unknown = await import(
  pathToFileURL(path.join(workspaceRoot, 'eslint.config.mjs')).href
)
const directory: string = mkdtempSync(path.join(tmpdir(), 'ploaness-empty-type-'))
const sourceDirectory: string = path.join(directory, 'src')
mkdirSync(sourceDirectory)
writeFileSync(
  path.join(directory, 'tsconfig.json'),
  JSON.stringify({ compilerOptions: { strict: true }, include: ['src/*.ts'] }),
)

const INVALID: string =
  "/** The resulting shape. */ export type Value = Omit<null | { name: string; value: number }, 'name'>\n"
const VALID: string =
  "/** The resulting shape. */ export type Value = Omit<NonNullable<null | { name: string; value: number }>, 'name'>\n"
const SOURCES: Readonly<Record<string, string>> = {
  invalid: INVALID,
  valid: VALID,
  suppressed: `// eslint-disable-next-line ${RULE} -- exercises the named exception\n${INVALID}`,
  needless: `// eslint-disable-next-line ${RULE} -- exercises the unused exception\n${VALID}`,
  descriptionless: `// eslint-disable-next-line ${RULE}\n${INVALID}`,
}
for (const [name, source] of Object.entries(SOURCES)) {
  writeFileSync(path.join(sourceDirectory, `${name}.ts`), source)
}
afterAll(() => {
  rmSync(directory, { recursive: true, force: true })
})

const lint = async (
  config: readonly Linter.Config[],
  name: string,
): Promise<readonly Linter.LintMessage[]> => {
  const eslint: ESLint = new ESLint({
    cwd: directory,
    overrideConfigFile: true,
    overrideConfig: [
      ...config,
      {
        languageOptions: {
          parserOptions: {
            projectService: false,
            project: './tsconfig.json',
            tsconfigRootDir: directory,
          },
        },
      },
    ],
  })
  const results: readonly ESLint.LintResult[] = await eslint.lintFiles([`src/${name}.ts`])
  const messages: readonly Linter.LintMessage[] = results.flatMap(
    (result: ESLint.LintResult): readonly Linter.LintMessage[] => result.messages,
  )
  expect(messages.filter((message: Linter.LintMessage): boolean => message.fatal === true)).toEqual(
    [],
  )
  return messages
}

describe.each([
  ['application', payloadConfig],
  ['library', libraryConfig],
  ['workspace', (workspaceModule as { readonly default: readonly Linter.Config[] }).default],
] as const)('%s generated empty types', (_name: string, config: readonly Linter.Config[]) => {
  it('rejects a utility type that loses its properties at error severity', async () => {
    const messages: readonly Linter.LintMessage[] = await lint(config, 'invalid')
    expect(
      messages.filter((message: Linter.LintMessage): boolean => message.ruleId === RULE),
    ).toEqual([expect.objectContaining({ severity: 2 })])
  })

  it('accepts a utility type that retains the intended properties', async () => {
    expect(await lint(config, 'valid')).toEqual([])
  })

  it('accepts a justified suppression on the affected line', async () => {
    expect(await lint(config, 'suppressed')).toEqual([])
  })

  it('rejects an exception that no longer suppresses a finding', async () => {
    const messages: readonly Linter.LintMessage[] = await lint(config, 'needless')
    expect(
      messages.some((message: Linter.LintMessage): boolean =>
        message.message.includes('Unused eslint-disable directive'),
      ),
    ).toBe(true)
  })

  it('rejects an exception without its justification', async () => {
    const messages: readonly Linter.LintMessage[] = await lint(config, 'descriptionless')
    expect(messages.map((message: Linter.LintMessage): string | null => message.ruleId)).toContain(
      '@eslint-community/eslint-comments/require-description',
    )
  })
})
