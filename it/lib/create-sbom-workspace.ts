// Independent installed workspace with known runtime, shared, transitive and development coordinates.
// With `copyleft-member`, the first member also takes a local package under a licence the allowlist
// refuses, which only an inventory of every importer reports.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { asRecord } from '@ploaness/governance'

const DIRECTORY_ARGUMENT: number = 2
const directory: string | undefined = process.argv[DIRECTORY_ARGUMENT]
if (directory === undefined) {
  throw new Error('Expected the SBOM fixture directory')
}
const MODE_ARGUMENT: number = 3
const hasCopyleftMember: boolean = process.argv[MODE_ARGUMENT] === 'copyleft-member'
const COPYLEFT_PACKAGE: string = 'copyleft-fixture'
const INDENT: number = 2
const manifestFile: string = path.join(directory, 'package.json')
const rootManifest: Record<string, unknown> = asRecord(JSON.parse(readFileSync(manifestFile, 'utf8')))
const harness: unknown = asRecord(rootManifest['devDependencies'])['ploaness']
if (hasCopyleftMember) {
  const vendored: string = path.join(directory, 'vendor', COPYLEFT_PACKAGE)
  mkdirSync(vendored, { recursive: true })
  writeFileSync(
    path.join(vendored, 'package.json'),
    `${JSON.stringify({ name: COPYLEFT_PACKAGE, version: '1.0.0', license: 'GPL-3.0-only' }, null, INDENT)}\n`,
  )
}
for (const name of ['one', 'two']) {
  const member: string = path.join(directory, 'packages', name)
  mkdirSync(member, { recursive: true })
  const copyleft: Record<string, string> =
    hasCopyleftMember && name === 'one' ? { [COPYLEFT_PACKAGE]: `file:../../vendor/${COPYLEFT_PACKAGE}` } : {}
  writeFileSync(
    path.join(member, 'package.json'),
    `${JSON.stringify(
      {
        name: `sbom-${name}`,
        version: '1.0.0',
        private: true,
        dependencies: { 'is-odd': '3.0.1', ...copyleft },
        devDependencies: { 'is-number': '7.0.0', ploaness: harness },
      },
      null,
      INDENT,
    )}\n`,
  )
}
const workspace: string = path.join(directory, 'pnpm-workspace.yaml')
// Exercise pnpm's importer-relative rewrite of root-relative overrides with the real packed archives.
const relativeArchives: string = readFileSync(workspace, 'utf8').replaceAll(
  /file:([^"\n]+\.tgz)/gu,
  (_match: string, archive: string): string => `file:${path.relative(directory, archive).split(path.sep).join('/')}`,
)
writeFileSync(workspace, `packages:\n  - 'packages/*'\n${relativeArchives}`)
