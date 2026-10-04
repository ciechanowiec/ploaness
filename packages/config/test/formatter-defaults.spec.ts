import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { asRecord, parseEditorconfig } from '@ploaness/governance'
import { describe, expect, it } from 'vitest'

const root: string = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const editorconfig: string = readFileSync(path.join(root, '.editorconfig'), 'utf8')
const configs: readonly string[] = [
  'packages/config/biome-core.json',
  'packages/ploaness/biome-core.json',
  'packages/ploaness/biome.json',
]

describe('the canonical and generated formatter defaults', () => {
  it.each(configs)('%s agrees with the managed editor defaults', (file: string) => {
    const config: Record<string, unknown> = asRecord(JSON.parse(readFileSync(path.join(root, file), 'utf8')))
    const general: Record<string, unknown> = asRecord(config['formatter'])
    expect(general['indentWidth']).toBe(parseEditorconfig(editorconfig, 'style.css').indentSize)
    expect(general['lineWidth']).toBe(parseEditorconfig(editorconfig, 'style.css').maxLineLength)
    for (const [language, extension] of [
      ['javascript', 'ts'],
      ['json', 'jsonc'],
    ] as const) {
      const effective: Record<string, unknown> = {
        ...general,
        ...asRecord(asRecord(config[language])['formatter']),
      }
      expect(effective['indentWidth']).toBe(parseEditorconfig(editorconfig, `example.${extension}`).indentSize)
      expect(effective['lineWidth']).toBe(parseEditorconfig(editorconfig, `example.${extension}`).maxLineLength)
    }
  })
})
