// Seed executable coverage evidence without importing an application or replacing its runner.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { asRecord } from '@ploaness/governance'

const ARGUMENT_OFFSET: number = 2
const [directory, kind, target, phase]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (directory === undefined || target === undefined || (kind !== 'application' && kind !== 'library')) {
  throw new Error('Expected fixture directory, application/library kind, target source, and optional covered phase')
}
const at = (relative: string): string => path.join(directory, relative)
const write = (relative: string, text: string): void => {
  mkdirSync(path.dirname(at(relative)), { recursive: true })
  writeFileSync(at(relative), text)
}
const MODULE: string = 'export const echo = (value: string): string => value\n'
const SPEC_IMPORTS: string = "import { expect, it } from 'vitest'\n"
const isCommonJs: boolean = target.endsWith('.cts')

const moduleImport = (): string =>
  isCommonJs
    ? "import { createRequire } from 'node:module'\n" +
      `const value: unknown = createRequire(import.meta.url)('../../${target}')\n` +
      'const { echo } = value as { readonly echo: (value: string) => string }\n'
    : `import { echo } from '../../${target.replace(/\.mts$/, '.mjs').replace(/\.ts$/, '.js')}'\n`

if (phase === 'covered') {
  write(
    'tests/int/target.int.spec.ts',
    `${SPEC_IMPORTS}${moduleImport()}` +
      "it('covers the declared source module', () => { expect(echo('observed')).toBe('observed') })\n",
  )
} else {
  const JSON_INDENT: number = 2
  rmSync(at('src'), { recursive: true, force: true })
  rmSync(at('tests/unit'), { recursive: true, force: true })
  rmSync(at('tests/int'), { recursive: true, force: true })
  const manifestText: string = readFileSync(at('package.json'), 'utf8')
  const manifest: Record<string, unknown> = asRecord(JSON.parse(manifestText))
  const dependencies: Record<string, unknown> = asRecord(manifest['dependencies'])
  const { payload: _payload, next: _next, ...libraryDependencies } = dependencies
  write(
    'package.json',
    `${JSON.stringify(
      {
        ...manifest,
        dependencies: kind === 'library' ? libraryDependencies : dependencies,
        ploaness: { ...asRecord(manifest['ploaness']), sourceRoots: ['domain', path.dirname(target)] },
      },
      null,
      JSON_INDENT,
    )}\n`,
  )
  write(
    'vitest.config.mts',
    `import config from 'ploaness/${kind === 'library' ? 'vitest-library' : 'vitest'}'\nexport default config\n`,
  )
  write('src/covered.ts', MODULE)
  write(target, isCommonJs ? 'const echo = (value: string): string => value\nmodule.exports = { echo }\n' : MODULE)
  write('domain/contracts.d.mts', 'export interface Contract { readonly value: string }\n')
  write(
    'domain/Component.tsx',
    "import type { ReactElement } from 'react'\nexport const Component = (): ReactElement => <span>component role</span>\n",
  )
  write(
    'tests/int/covered.int.spec.ts',
    `${SPEC_IMPORTS}import { echo } from '../../src/covered.js'\n` +
      "it('covers the existing source module', () => { expect(echo('baseline')).toBe('baseline') })\n",
  )
}
