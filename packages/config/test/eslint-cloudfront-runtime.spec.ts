import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ESLint, type Linter } from 'eslint'
import { defineConfig } from 'eslint/config'
import { afterAll, describe, expect, it } from 'vitest'
import payloadConfig from '../dist/eslint.js'
import { allowlistedJavaScript, commonJavaScriptBlock, javascriptBlock } from '../dist/eslint-core.js'
import { cloudFrontBlock } from '../dist/eslint-runtime.js'

// A file whose allowlist entry declares `cloudfront-js-2.0` is linted against what that engine supports;
// the same file declared `node` is linted as it always was. The block is composed exactly as the shipped
// configurations compose it, after the general JavaScript block.

const CLOUDFRONT: readonly string[] = ['^edge/']
const NODE: readonly string[] = ['^tools/']
const ALLOWLIST: readonly string[] = [...CLOUDFRONT, ...NODE]
const RUNTIME_RULES: ReadonlySet<string> = new Set<string>(['no-restricted-syntax', 'no-restricted-globals'])

const directory: string = mkdtempSync(path.join(tmpdir(), 'ploaness-cloudfront-runtime-'))
mkdirSync(path.join(directory, 'src'))
mkdirSync(path.join(directory, 'edge'))
mkdirSync(path.join(directory, 'tools'))
writeFileSync(
  path.join(directory, 'tsconfig.json'),
  JSON.stringify({ compilerOptions: { strict: true }, include: ['src/*.ts'] }),
)
writeFileSync(path.join(directory, 'src', 'index.ts'), 'export const value: number = 1\n')
afterAll(() => {
  rmSync(directory, { recursive: true, force: true })
})

const eslint: ESLint = new ESLint({
  cwd: directory,
  overrideConfigFile: true,
  overrideConfig: defineConfig([
    ...payloadConfig,
    {
      languageOptions: {
        parserOptions: { projectService: false, project: './tsconfig.json', tsconfigRootDir: directory },
      },
    },
    javascriptBlock([allowlistedJavaScript([...ALLOWLIST], directory)]),
    cloudFrontBlock([allowlistedJavaScript([...CLOUDFRONT], directory)]),
    commonJavaScriptBlock(ALLOWLIST, directory),
  ]),
})

const lint = async (directoryName: string, body: string): Promise<readonly Linter.LintMessage[]> => {
  // CI's parser treats repeated parses of one path as autofix passes, so every case lints its own file.
  const file: string = path.join(directoryName, `${randomUUID()}.cjs`)
  writeFileSync(path.join(directory, file), `'use strict'\n\n${body}\n`)
  const results: readonly ESLint.LintResult[] = await eslint.lintFiles([file])
  return results.flatMap((result: ESLint.LintResult): readonly Linter.LintMessage[] => result.messages)
}

const runtimeFindings = async (directoryName: string, body: string): Promise<readonly string[]> => {
  const messages: readonly Linter.LintMessage[] = await lint(directoryName, body)
  return messages
    .filter(
      (message: Linter.LintMessage): boolean =>
        message.fatal === true || RUNTIME_RULES.has(message.ruleId ?? '') || message.message.includes('cloudfront'),
    )
    .map(
      (message: Linter.LintMessage): string => `${String(message.line)}:${String(message.column)} ${message.message}`,
    )
}

const REJECTED: readonly (readonly [string, string, string])[] = [
  [
    'a destructured parameter',
    'module.exports = (querystring) =>\n  Object.entries(querystring).map(([name, entry]) => name + entry.value)',
    'destructuring is not supported by runtime cloudfront-js-2.0',
  ],
  [
    'a destructuring declaration with a rest element',
    "module.exports = (uri) => {\n  const [tag, ...rest] = uri.split('/')\n  return tag + rest.join('/')\n}",
    'destructuring is not supported by runtime cloudfront-js-2.0',
  ],
  [
    'an object destructuring declaration',
    'module.exports = (event) => {\n  const { request } = event\n  return request\n}',
    'destructuring is not supported by runtime cloudfront-js-2.0',
  ],
  [
    'object spread',
    "module.exports = (request) => ({ ...request, uri: '/index.html' })",
    'object spread is not supported by runtime cloudfront-js-2.0',
  ],
  [
    'the global Set',
    "const ALLOWED = new Set(['GET', 'HEAD'])\n\nmodule.exports = (method) => ALLOWED.has(method)",
    'Set is not supported by runtime cloudfront-js-2.0',
  ],
]

const SUPPORTED: readonly (readonly [string, string])[] = [
  [
    'Object.keys with an indexed read instead of a destructured pair',
    'module.exports = (querystring) =>\n  Object.keys(querystring).map((name) => name + querystring[name].value)',
  ],
  [
    'an index and slice instead of a destructured head and tail',
    "module.exports = (uri) => {\n  const parts = uri.split('/')\n  return parts[0] + parts.slice(1).join('/')\n}",
  ],
  [
    'Object.assign instead of object spread',
    "module.exports = (request) => Object.assign({}, request, { uri: '/index.html' })",
  ],
  [
    'an array searched with includes instead of a Set',
    "const ALLOWED = ['GET', 'HEAD']\n\nmodule.exports = (method) => ALLOWED.includes(method)",
  ],
  ['a rest parameter', "module.exports = (...segments) => segments.join('/')"],
  ['array and object literals', "module.exports = (uri) => ({ uri, parts: [uri, 'index.html'] })"],
  [
    'a local binding named Set, and the name inside a string and a comment',
    "// Set is not used here.\nconst Set = (value) => 'Set ' + value\n\nmodule.exports = (value) => Set(value)",
  ],
]

describe('the cloudfront-js-2.0 runtime', () => {
  it.each(REJECTED)('rejects %s', async (_: string, body: string, expected: string) => {
    const findings: readonly string[] = await runtimeFindings('edge', body)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toContain(expected)
  })

  it('reports the destructured pair at the pattern, not at the misleading arrow', async () => {
    const findings: readonly string[] = await runtimeFindings('edge', REJECTED[0]?.[1] ?? '')
    expect(findings[0]).toMatch(/^4:36 /u)
  })

  it.each(SUPPORTED)('accepts %s', async (_: string, body: string) => {
    expect(await runtimeFindings('edge', body)).toEqual([])
  })

  it('does not ask for the Set it bans', async () => {
    const messages: readonly Linter.LintMessage[] = await lint('edge', SUPPORTED[3]?.[1] ?? '')
    expect(messages.map((message: Linter.LintMessage): string | null => message.ruleId)).not.toContain(
      'unicorn/prefer-set-has',
    )
  })
})

describe('the node runtime', () => {
  it.each(REJECTED)('leaves %s to the Node.js rules', async (_: string, body: string) => {
    expect(await runtimeFindings('tools', body)).toEqual([])
  })
})
