import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { noticeFilesIn } from '../src/compliance-report.js'

const SPEC_DIRECTORY: string = path.dirname(fileURLToPath(import.meta.url))
const OVERSIZED_BYTES: number = 262_145

describe('notice files read from an installed package', () => {
  it('reads only regular licence and notice files of a bounded size, never through a link', () => {
    const root: string = mkdtempSync(path.join(SPEC_DIRECTORY, 'ploaness notices '))
    try {
      const outside: string = path.join(root, 'private-key')
      writeFileSync(outside, 'secret material the report must never carry\n')
      const installed: string = path.join(root, 'package')
      mkdirSync(installed)
      writeFileSync(path.join(installed, 'LICENSE'), 'MIT License\n')
      writeFileSync(path.join(installed, 'notice.md'), 'Attribution\n')
      writeFileSync(path.join(installed, 'README.md'), 'not a licence\n')
      writeFileSync(path.join(installed, 'COPYING'), 'x'.repeat(OVERSIZED_BYTES))
      mkdirSync(path.join(installed, 'LICENSES'))
      symlinkSync(outside, path.join(installed, 'LICENCE.txt'))
      for (const secret of [
        'license.key',
        'LICENSE.pem',
        'notice.env',
        'COPYING.json',
        'license-key.txt',
        'NOTICE-PRIVATE.md',
      ]) {
        writeFileSync(path.join(installed, secret), 'secret material the report must never carry\n')
      }
      writeFileSync(path.join(installed, 'LICENSE-3RD-PARTY.txt'), 'Bundled\n')
      writeFileSync(path.join(installed, 'LICENSE.BSD'), 'BSD\n')
      expect(noticeFilesIn(installed)).toEqual([
        { name: 'LICENSE', text: 'MIT License\n' },
        { name: 'LICENSE-3RD-PARTY.txt', text: 'Bundled\n' },
        { name: 'LICENSE.BSD', text: 'BSD\n' },
        { name: 'notice.md', text: 'Attribution\n' },
      ])
      expect(noticeFilesIn(path.join(root, 'absent'))).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
