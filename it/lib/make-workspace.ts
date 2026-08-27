// Turns the single-package fixture into a workspace, in place.
//
// Reshaping the installed template rather than installing a second fixture is deliberate: a second
// `pnpm install` would double the suite's slowest step to prove something about resolution that the
// first install already established. What the workspace cases are about is which directory a rule reads
// from, and that is decided by the tree's shape rather than by how it was installed.
//
// The result has three members. `apps/web` is the Payload application, moved wholesale from the
// template so it keeps the source the shipped rules expect. `packages/ui` is a library: no framework, so
// it receives the framework-neutral configurations and is asked for no browser. The root is a member
// too, because it owns the scripts a run is invoked through.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { asRecord } from '@ploaness/governance'

const ARGUMENT_OFFSET: number = 2

const [directory]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (directory === undefined) {
  throw new Error('usage: make-workspace.ts <directory>')
}

const JSON_INDENT: number = 2

const readJson = (file: string): Record<string, unknown> =>
  asRecord(JSON.parse(readFileSync(file, 'utf8')))

const writeJson = (file: string, value: Record<string, unknown>): void => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, JSON_INDENT)}\n`)
}

const at = (...segments: readonly string[]): string => path.join(directory, ...segments)

const rootManifest: Record<string, unknown> = readJson(at('package.json'))

// The application keeps every dependency and every ploaness setting the template declared: it IS the
// template's project, one directory down.
const web: Record<string, unknown> = {
  name: 'fixture-web',
  version: '1.0.0',
  private: true,
  type: 'module',
  dependencies: rootManifest['dependencies'],
  devDependencies: rootManifest['devDependencies'],
  // Declared here and nowhere above, which is the whole point of it: see the route it exempts below.
  ploaness: {
    frameworkGlue: [
      {
        pattern: 'src/app/api/**',
        reason: "the route layer is Next's own mount, whose signatures the framework decides",
      },
    ],
  },
}

// A library declares the harness - that is what makes it governed - and the test packages its own specs
// import. It declares no framework, which is what makes it a library rather than an application.
const ui: Record<string, unknown> = {
  name: 'fixture-ui',
  version: '1.0.0',
  private: true,
  type: 'module',
  devDependencies: {
    ploaness: asRecord(rootManifest['devDependencies'])['ploaness'],
    typescript: asRecord(rootManifest['devDependencies'])['typescript'],
    vitest: asRecord(rootManifest['devDependencies'])['vitest'],
    '@vitest/coverage-v8': asRecord(rootManifest['devDependencies'])['@vitest/coverage-v8'],
    '@types/node': asRecord(rootManifest['devDependencies'])['@types/node'],
  },
}

mkdirSync(at('apps', 'web'), { recursive: true })
mkdirSync(at('packages', 'ui'), { recursive: true })

// Everything the application owns moves wholesale, so it keeps the source and the configuration the
// shipped rules expect to find beside each other.
const MOVED: readonly string[] = [
  'src',
  'tests',
  'biome.json',
  'tsconfig.json',
  'eslint.config.mjs',
  'vitest.config.mts',
  'playwright.config.ts',
]
for (const moved of MOVED) {
  renameSync(at(moved), at('apps', 'web', moved))
}

writeJson(at('apps', 'web', 'package.json'), web)
writeJson(at('packages', 'ui', 'package.json'), ui)

// A file the application's OWN settings exempt and the root's do not. The shipped configurations read
// their settings from the package.json of the WORKING DIRECTORY, so a member's declarations are
// invisible to a run started at the root: the block that relaxes the framework glue is rendered from
// the ROOT's `frameworkGlue`, under which this route is ordinary source owing a return type, a module
// boundary type, and an `await`. That divergence is what makes the root's eslint assertion load-bearing
// rather than decorative, and it is the exact shape that reported 43 findings against a member whose
// own gate reported none.
mkdirSync(at('apps', 'web', 'src', 'app', 'api', 'health'), { recursive: true })
writeFileSync(
  at('apps', 'web', 'src', 'app', 'api', 'health', 'route.ts'),
  "export const GET = async () => new Response('ok')\n",
)

// The library needs something to be a library ABOUT, or the suite gate passes it for holding no source
// and proves less than it looks like it does.
mkdirSync(at('packages', 'ui', 'src'), { recursive: true })
writeFileSync(
  at('packages', 'ui', 'src', 'greet.ts'),
  // Concatenation rather than a template literal: written as one it would be a template placeholder
  // inside a string here, which the lint pass reads as a mistake rather than as generated source.
  '/**\n * Greet someone by name.\n * @param name who to greet.\n * @returns the greeting.\n */\n' +
    "export const greet = (name: string): string => 'Hello, ' + name\n",
)
mkdirSync(at('packages', 'ui', 'tests', 'unit'), { recursive: true })
writeFileSync(
  at('packages', 'ui', 'tests', 'unit', 'greet.unit.spec.ts'),
  "import { describe, expect, it } from 'vitest'\n" +
    "import { greet } from '../../src/greet.js'\n\n" +
    "describe('greet', () => {\n" +
    "  it('addresses the name it is given', () => {\n" +
    "    expect(greet('world')).toBe('Hello, world')\n" +
    '  })\n})\n',
)

// The root keeps the scripts, the package manager and the engines - the declarations pnpm and an
// installer read once per repository - and nothing else.
// The root keeps the suite packages as well as the harness. A workspace root that owns shared scripts
// runs specs over them, and under pnpm's strict layout those specs cannot resolve a runner the root
// does not declare.
const declared: Record<string, unknown> = asRecord(rootManifest['devDependencies'])
writeJson(at('package.json'), {
  name: 'fixture-workspace',
  version: '1.0.0',
  private: true,
  type: 'module',
  scripts: rootManifest['scripts'],
  devDependencies: {
    ploaness: declared['ploaness'],
    typescript: declared['typescript'],
    vitest: declared['vitest'],
    '@vitest/coverage-v8': declared['@vitest/coverage-v8'],
    '@types/node': declared['@types/node'],
  },
  packageManager: rootManifest['packageManager'],
  engines: rootManifest['engines'],
})

const workspaceFile: string = at('pnpm-workspace.yaml')
writeFileSync(
  workspaceFile,
  `packages:\n  - 'apps/*'\n  - 'packages/*'\n\n${readFileSync(workspaceFile, 'utf8')}`,
)
