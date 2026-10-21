import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { asRecord } from '@ploaness/governance'
import { format } from 'prettier'
import stylelint from 'stylelint'
import { describe, expect, it } from 'vitest'

const configDirectory: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config')
const stylelintConfig: string = path.join(configDirectory, 'stylelint.json')

const warnings = async (code: string, filename: string): Promise<readonly string[]> => {
  const result: Awaited<ReturnType<typeof stylelint.lint>> = await stylelint.lint({
    code,
    codeFilename: filename,
    configFile: stylelintConfig,
  })
  return result.results.flatMap((file) => file.warnings.map((warning) => warning.rule))
}

describe('stylesheet dialects', { timeout: 30_000 }, () => {
  it('accepts the empty stylesheet supplied by the Payload template', async () => {
    expect(await warnings('', 'src/app/(payload)/custom.scss')).toEqual([])
  })

  it('accepts SCSS variables, mixins, interpolation and nesting', async () => {
    expect(
      await warnings(
        '$tone: #fff; $name: card; @mixin paint { color: $tone; } ' +
          '.#{$name} { @include paint; &:hover { color: #000; } }',
        'src/custom.scss',
      ),
    ).toEqual([])
  })

  it('rejects unknown SCSS directives', async () => {
    expect(await warnings('.card { @incldue paint; }', 'src/custom.scss')).toContain('scss/at-rule-no-unknown')
  })

  it('retains core CSS validation in SCSS', async () => {
    expect(await warnings('.card { color: #ggg; }', 'src/custom.scss')).toContain('color-no-invalid-hex')
  })

  it('keeps SCSS syntax out of ordinary CSS', async () => {
    expect(await warnings('.card { @include paint; }', 'src/custom.css')).toContain('at-rule-no-unknown')
  })

  it('accepts Tailwind directives in CSS', async () => {
    expect(await warnings('@theme { --color-ink: #000; } .card { @apply flex; }', 'src/custom.css')).toEqual([])
  })

  it('reports a suppression without an explanation', async () => {
    const result: Awaited<ReturnType<typeof stylelint.lint>> = await stylelint.lint({
      code: '/* stylelint-disable color-no-invalid-hex */\n.card { color: #ggg; }',
      codeFilename: 'src/custom.scss',
      configFile: stylelintConfig,
    })
    expect(result.results.flatMap((file) => file.warnings.map((warning) => warning.text)).join('\n')).toContain(
      'description',
    )
  })

  it('formats SCSS deterministically with the shipped stylelintConfig', async () => {
    const options: Record<string, unknown> = asRecord(
      JSON.parse(readFileSync(path.join(configDirectory, 'prettier-scss.json'), 'utf8')),
    )
    const source: string = '.card{color:red}'
    const formatted: string = await format(source, { ...options, parser: 'scss' })
    expect(formatted).toBe('.card {\n    color: red;\n}\n')
    expect(await format(formatted, { ...options, parser: 'scss' })).toBe(formatted)
  })
})
