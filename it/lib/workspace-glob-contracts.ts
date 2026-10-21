// Compare pure workspace selection with the pinned pnpm over real package manifests.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isArray, readKey, selectProjects } from '@ploaness/governance'

const COMMAND_TIMEOUT_MS: number = 30_000
const root: string = realpathSync(process.cwd())
const workspaceFile: string = path.join(root, 'pnpm-workspace.yaml')
const original: string = readFileSync(workspaceFile, 'utf8')
const DIRECTORIES: readonly string[] = [
  '.',
  'apps/cms',
  'packages/ui',
  'packages/shared',
  'packages/.hidden',
  'packages/[ui]',
  'packages/{ui}',
  'packages/𠮷',
]
const PATTERNS: readonly (readonly string[])[] = [
  ['apps/cms', 'packages/{ui,shared}'],
  ['./packages/*'],
  ['packages/*/'],
  ['packages//*'],
  ['packages/../packages/*'],
  ['{packages/ui/../shared,packages/ui}'],
  ['packages/**'],
  ['packages/?'],
  ['packages/??'],
  ['packages/.hidden'],
  ['packages/.*/**'],
  ['!packages/{ui,shared}', 'packages/*'],
  ['packages/*', '!./packages/ui'],
  ['future/*'],
]

const sorted = (values: readonly string[]): readonly string[] =>
  values.toSorted((left: string, right: string): number => left.localeCompare(right))

const projectsFromPnpm = (): readonly string[] => {
  const raw: unknown = JSON.parse(
    execFileSync('pnpm', ['-r', 'list', '--depth=-1', '--json'], { encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS }),
  )
  if (!isArray(raw)) {
    throw new TypeError('pnpm did not return a project list')
  }
  return raw.map((project: unknown): string => {
    const directory: unknown = readKey(project, 'path')
    if (typeof directory !== 'string') {
      throw new TypeError('pnpm returned a project without its path')
    }
    return path.relative(root, directory) || '.'
  })
}

const requireUnsupported = (pattern: string): void => {
  try {
    selectProjects([pattern], DIRECTORIES)
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('pnpm-workspace.yaml packages')) {
      return
    }
    throw error
  }
  throw new Error(`Unsupported pattern was silently accepted: ${pattern}`)
}

const members: readonly string[] = DIRECTORIES.filter((entry: string): boolean => entry !== '.')
for (const [index, directory] of members.entries()) {
  const full: string = path.join(root, directory)
  mkdirSync(full, { recursive: true })
  writeFileSync(
    path.join(full, 'package.json'),
    JSON.stringify({ name: `glob-member-${String(index)}`, version: '1.0.0', private: true }),
  )
}

try {
  for (const patterns of PATTERNS) {
    writeFileSync(workspaceFile, `packages: ${JSON.stringify(patterns)}\n${original}`)
    const expected: readonly string[] = sorted(projectsFromPnpm())
    const actual: readonly string[] = sorted(selectProjects(patterns, DIRECTORIES))
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `Workspace selection disagrees for ${JSON.stringify(patterns)}: ${JSON.stringify({ expected, actual })}`,
      )
    }
  }
  for (const pattern of [
    'packages/{ui}',
    'packages/{{ui,shared}}',
    'packages/[ui]',
    'packages/[!u]*',
    'packages/[^u]*',
    'packages/(ui|shared)',
    'packages/ui|shared',
    'packages/ui$',
    'packages/"ui"',
    String.raw`packages/\ui`,
    'packages/**/**',
    'packages/{,ui}',
  ]) {
    requireUnsupported(pattern)
  }
} finally {
  writeFileSync(workspaceFile, original)
}
console.info('workspace patterns agree with pinned pnpm')
