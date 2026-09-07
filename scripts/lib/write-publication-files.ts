// Generate publication READMEs and licenses from package metadata and canonical repository content.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { asRecord, asStringRecord } from '@ploaness/governance'

const workspaceRoot: string = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The scope the internal packages carry. The one package WITHOUT it is the one a consumer installs. */
const HARNESS_SCOPE: string = '@ploaness/'

interface PackageFields {
  readonly directory: string
  readonly name: string
  readonly description: string
  readonly homepage: string
  readonly license: string
}

// Missing fields are fatal rather than rendered as "undefined". A page is published once and cannot be
// corrected in place, so the cheapest moment to notice an empty description is before the tarball exists.
const readText = (file: string): string => readFileSync(path.join(workspaceRoot, file), 'utf8')

const readFields = (directory: string): PackageFields => {
  const manifest: string = path.posix.join('packages', directory, 'package.json')
  const parsed: unknown = JSON.parse(readText(manifest))
  const fields: Record<string, string> = asStringRecord(asRecord(parsed))
  const required: readonly string[] = ['name', 'description', 'homepage', 'license']
  const missing: readonly string[] = required.filter(
    (key: string): boolean => (fields[key] ?? '') === '',
  )
  if (missing.length > 0) {
    throw new Error(`${manifest} declares no ${missing.join(', ')}`)
  }
  return {
    directory,
    name: String(fields['name']),
    description: String(fields['description']),
    homepage: String(fields['homepage']),
    license: String(fields['license']),
  }
}

// Application helpers have a production install path; analyzer packages are reached through the harness.
const opening = (fields: PackageFields): readonly string[] => {
  if (fields.name === '@ploaness/runtime') {
    return [
      'Applications declare `@ploaness/runtime` in `dependencies` at the same version as their ' +
        '`ploaness` devDependency. Import production helpers from `@ploaness/runtime`.',
    ]
  }
  return fields.name.startsWith(HARNESS_SCOPE)
    ? [
        'This package is published as part of `ploaness` and is not meant to be depended on ' +
          'directly. Install `ploaness`, which re-exports what a project needs.',
      ]
    : [
        '## Install',
        '',
        '```sh',
        'pnpm add -D ploaness',
        'pnpm ploaness init',
        'pnpm ploaness verify',
        '```',
      ]
}

const render = (fields: PackageFields): string =>
  [
    `# ${fields.name}`,
    '',
    fields.description,
    '',
    ...opening(fields),
    '',
    '## Documentation',
    '',
    `<${fields.homepage}>`,
    '',
    '## License',
    '',
    `${fields.license}. See the LICENSE file in this package.`,
    '',
  ].join('\n')

const licenceText: string = readText('LICENSE')

// Discovered from the tree rather than enumerated, for the reason `pack-local.sh` globs: a hard-coded
// list of five is a sixth package away from publishing one with no page at all.
const written: readonly string[] = readdirSync(path.join(workspaceRoot, 'packages'), {
  withFileTypes: true,
})
  .filter((entry): boolean => entry.isDirectory())
  .map((entry): string => {
    const fields: PackageFields = readFields(entry.name)
    const directory: string = path.join(workspaceRoot, 'packages', entry.name)
    writeFileSync(path.join(directory, 'README.md'), render(fields))
    writeFileSync(path.join(directory, 'LICENSE'), licenceText)
    return fields.name
  })

console.info(`wrote README.md and LICENSE for: ${written.join(', ')}`)
