// Real files exercise both gates through the same working-tree inventory used in a consumer.
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { conventions } from '../src/checks/conventions.js'
import { editorconfig } from '../src/checks/editorconfig.js'
import { type Context, createContext } from '../src/context.js'
import type { GateResult } from '../src/exec.js'

const SPEC_DIRECTORY: string = path.dirname(fileURLToPath(import.meta.url))
const PREFIX: string = path.join(SPEC_DIRECTORY, 'tmp-binary-formatting-')
const EDITORCONFIG: string = path.join(SPEC_DIRECTORY, '../../assets/files/.editorconfig.asset')
const EM_DASH: string = String.fromCodePoint(0x20_14)
const OFFENDING_TEXT: string = `content ${EM_DASH} with trailing whitespace   \r\n`
const TEXT_FILE_COUNT: number = 2

interface Fixture {
  readonly name: string
  readonly content: Uint8Array
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

const BINARY_FILES: readonly Fixture[] = [
  { name: 'late-nul.bin', content: encode(`${'header\n'.repeat(6000)}\0${OFFENDING_TEXT}`) },
  { name: 'non-utf8.bin', content: new Uint8Array([...encode(OFFENDING_TEXT), 0xff]) },
  { name: 'document.pdf', content: encode(`%PDF-1.7\n${OFFENDING_TEXT}%%EOF`) },
]

const withProject = (fixture: Fixture, use: (context: Context) => void): void => {
  const root: string = mkdtempSync(PREFIX)
  try {
    copyFileSync(EDITORCONFIG, path.join(root, '.editorconfig'))
    writeFileSync(path.join(root, 'package.json'), '{"name":"binary-formatting-fixture"}\n')
    writeFileSync(path.join(root, fixture.name), fixture.content)
    use(createContext(root, true))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('binary file roles in formatting gates', () => {
  it.each(BINARY_FILES)('excludes $name from typography and EditorConfig', (fixture: Fixture): void => {
    withProject(fixture, (context: Context): void => {
      expect(conventions(context).findings).toEqual([])
      const result: GateResult = editorconfig(context)
      expect(result.findings).toEqual([])
      expect(result.summary).toContain(`${String(TEXT_FILE_COUNT)} working-tree file(s)`)
    })
  })

  it.each(['README.adoc', 'drawing.svg', 'settings.json', 'misnamed.pdf'])(
    'still judges text in %s, regardless of the filename',
    (name: string): void => {
      withProject({ name, content: encode(OFFENDING_TEXT) }, (context: Context): void => {
        expect(conventions(context).findings.join('\n')).toContain(`${name}:1:9 banned em dash`)
        expect(editorconfig(context).findings.join('\n')).toContain(`${name}:1 trailing whitespace`)
      })
    },
  )
})
