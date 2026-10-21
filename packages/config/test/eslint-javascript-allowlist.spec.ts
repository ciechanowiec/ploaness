import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ESLint, type Linter } from 'eslint'
import { defineConfig } from 'eslint/config'
import { afterAll, describe, expect, it } from 'vitest'
import payloadConfig from '../dist/eslint.js'
import { allowlistedJavaScript, commonJavaScriptBlock, javascriptBlock } from '../dist/eslint-core.js'
import libraryConfig from '../dist/eslint-library.js'

// A file the conventions gate admits through javascriptAllowlist must reach ESLint as JavaScript. The
// type-aware parser knows only the TypeScript project, so without the JavaScript block it fails on the
// file outright instead of judging it.

const CONFIGURATIONS: Readonly<Record<string, readonly Linter.Config[]>> = {
  payload: payloadConfig,
  library: libraryConfig,
}
const ALLOWLIST: readonly string[] = [String.raw`^infra/edge-function\.js$`, String.raw`\.cjs$`]
const SOURCE: string = 'export const handler = (event) => event.request\n'
const MAGIC_NUMBER: string = 'export const handler = (event) => event.request.uri.length > 42\n'

const directory: string = mkdtempSync(path.join(tmpdir(), 'ploaness-javascript-allowlist-'))
mkdirSync(path.join(directory, 'src'))
mkdirSync(path.join(directory, 'infra'))
writeFileSync(
  path.join(directory, 'tsconfig.json'),
  JSON.stringify({ compilerOptions: { strict: true }, include: ['src/*.ts'] }),
)
writeFileSync(path.join(directory, 'src', 'index.ts'), 'export const value: number = 1\n')
// CI's parser treats repeated parses of one path as autofix passes, so each kind lints its own files.
for (const kind of Object.keys(CONFIGURATIONS)) {
  writeFileSync(path.join(directory, 'infra', `${kind}-stray.js`), SOURCE)
}
afterAll(() => {
  rmSync(directory, { recursive: true, force: true })
})

const lint = async (
  config: readonly Linter.Config[],
  file: string,
  source: string,
): Promise<readonly Linter.LintMessage[]> => {
  writeFileSync(path.join(directory, file), source)
  const eslint: ESLint = new ESLint({
    cwd: directory,
    overrideConfigFile: true,
    // The block declares `extends`, which only defineConfig resolves, as it does in the shipped configs.
    overrideConfig: defineConfig([
      ...config,
      {
        languageOptions: {
          parserOptions: { projectService: false, project: './tsconfig.json', tsconfigRootDir: directory },
        },
      },
      javascriptBlock([allowlistedJavaScript([...ALLOWLIST], directory)]),
      commonJavaScriptBlock(ALLOWLIST, directory),
    ]),
  })
  const results: readonly ESLint.LintResult[] = await eslint.lintFiles([file])
  return results.flatMap((result: ESLint.LintResult): readonly Linter.LintMessage[] => result.messages)
}

const fatal = (messages: readonly Linter.LintMessage[]): readonly Linter.LintMessage[] =>
  messages.filter((message: Linter.LintMessage): boolean => message.fatal === true)

describe('allowlistedJavaScript', () => {
  it('matches the path relative to the member against the allowlist', () => {
    const isAllowlisted: (filePath: string) => boolean = allowlistedJavaScript([...ALLOWLIST], directory)
    expect(isAllowlisted(path.join(directory, 'infra', 'edge-function.js'))).toBe(true)
    expect(isAllowlisted(path.join(directory, 'infra', 'other.js'))).toBe(false)
    expect(isAllowlisted(path.join(directory, 'nested', 'infra', 'edge-function.js'))).toBe(false)
  })

  it('does not relax TypeScript files reached by a broad allowlist', () => {
    const isAllowlisted: (filePath: string) => boolean = allowlistedJavaScript(['^infra/'], directory)
    expect(isAllowlisted(path.join(directory, 'infra', 'read.ts'))).toBe(false)
    expect(isAllowlisted(path.join(directory, 'infra', 'view.jsx'))).toBe(true)
  })

  it('reads a member-scoped pattern within its member only', () => {
    const isAllowlisted: (filePath: string) => boolean = allowlistedJavaScript(
      [{ memberPath: 'apps/web', pattern: String.raw`^shim\.js$` }],
      directory,
    )
    expect(isAllowlisted(path.join(directory, 'apps', 'web', 'shim.js'))).toBe(true)
    expect(isAllowlisted(path.join(directory, 'packages', 'ui', 'shim.js'))).toBe(false)
  })
})

describe.each(Object.entries(CONFIGURATIONS))(
  '%s allowlisted JavaScript',
  (kind: string, config: readonly Linter.Config[]) => {
    it('lints an allowlisted file as JavaScript instead of failing to parse it', async () => {
      expect(await lint(config, `infra/edge-function.js`, SOURCE)).toEqual([])
    })

    it('holds an allowlisted file to the code rules', async () => {
      const messages: readonly Linter.LintMessage[] = await lint(config, 'infra/edge-function.js', MAGIC_NUMBER)
      expect(fatal(messages)).toEqual([])
      expect(messages.map((message: Linter.LintMessage): string | null => message.ruleId)).toContain('no-magic-numbers')
    })

    it('accepts CommonJS exports without a global or mutation suppression', async () => {
      const messages: readonly Linter.LintMessage[] = await lint(
        config,
        `infra/${kind}-exports.cjs`,
        'const edge = (event) => event.request\nmodule.exports = edge\n',
      )
      expect(messages).toEqual([])
    })

    it('rejects mutation within an exported CommonJS value', async () => {
      const messages: readonly Linter.LintMessage[] = await lint(
        config,
        `infra/${kind}-mutation.cjs`,
        'module.exports = []\nmodule.exports.push(1)\n',
      )
      expect(messages.map((message) => message.ruleId)).toContain('functional/immutable-data')
    })

    it('does not exempt a local object shadowing the CommonJS runtime', async () => {
      const messages: readonly Linter.LintMessage[] = await lint(
        config,
        `infra/${kind}-shadow.cjs`,
        'const module = { exports: 1 }\nmodule.exports = 2\n',
      )
      expect(messages.map((message) => message.ruleId)).toContain('functional/immutable-data')
    })

    it('accepts the CommonJS dependency-loading syntax', async () => {
      expect(
        await lint(config, `infra/${kind}-require.cjs`, "const path = require('node:path')\nmodule.exports = path\n"),
      ).toEqual([])
    })

    it('accepts a named CommonJS export during module initialization', async () => {
      expect(await lint(config, `infra/${kind}-named.cjs`, 'module.exports.edge = (event) => event.request\n')).toEqual(
        [],
      )
    })

    it('rejects export mutation after module initialization', async () => {
      const messages: readonly Linter.LintMessage[] = await lint(
        config,
        `infra/${kind}-late.cjs`,
        'const refresh = () => { exports.value = 1 }\nmodule.exports = refresh\n',
      )
      expect(messages.map((message) => message.ruleId)).toContain('functional/immutable-data')
    })

    it('still reads a file outside the allowlist with the type-aware parser', async () => {
      const messages: readonly Linter.LintMessage[] = await lint(config, `infra/${kind}-stray.js`, SOURCE)
      expect(fatal(messages)).toEqual([expect.objectContaining({ severity: 2 })])
    })
  },
)
