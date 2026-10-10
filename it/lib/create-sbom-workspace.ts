// Independent installed workspace with known runtime, shared, transitive and development coordinates.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { asRecord } from '@ploaness/governance'

const DIRECTORY_ARGUMENT: number = 2
const directory: string | undefined = process.argv[DIRECTORY_ARGUMENT]
if (directory === undefined) {
  throw new Error('Expected the SBOM fixture directory')
}
const INDENT: number = 2
const manifestFile: string = path.join(directory, 'package.json')
const rootManifest: Record<string, unknown> = asRecord(JSON.parse(readFileSync(manifestFile, 'utf8')))
const harness: unknown = asRecord(rootManifest['devDependencies'])['ploaness']
for (const name of ['one', 'two']) {
  const member: string = path.join(directory, 'packages', name)
  mkdirSync(member, { recursive: true })
  writeFileSync(
    path.join(member, 'package.json'),
    `${JSON.stringify(
      {
        name: `sbom-${name}`,
        version: '1.0.0',
        private: true,
        dependencies: { 'is-odd': '3.0.1' },
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
