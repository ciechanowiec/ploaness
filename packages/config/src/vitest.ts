// The Vitest configuration ploaness owns. A consuming project re-exports it verbatim; the only
// project-specific input is the coverage exclusion list, which the project declares under the `ploaness`
// key of its package.json rather than by editing this file.
//
// The coverage policy is default-safe, which is the point: EVERY TypeScript module under the declared
// source roots is in scope, and exemptions are carved out by ROLE, never by naming a handful of folders
// that happen to have tests today. A new logic directory is therefore covered the moment it exists,
// instead of silently escaping an allowlist nobody remembered to extend. With `include` set, Vitest
// counts every matching file even when no test imports it, so an untested unit scores zero and fails the
// gate rather than being invisible.
import { COVERAGE_INCLUDE } from '@ploaness/governance'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { projectSettings as settings } from './project-settings.js'
import {
  COVERAGE_THRESHOLD,
  DETERMINISTIC_SEQUENCE,
  harnessSetupFile,
  projectSetupFiles,
  testReporters,
} from './vitest-core.js'

/** One collected suite: which specs it holds, and the realm they need. */
interface Suite {
  readonly name: string
  readonly environment: 'jsdom' | 'node'
  readonly include: readonly string[]
}

// The environment is per suite rather than per repository, and that split is load-bearing rather than
// tidy. `jsdom` installs its OWN realm's globals, typed-array constructors included, so a Node `Buffer`
// fails `input instanceof Uint8Array` inside any library that guards its input that way - the check
// compares constructor identity, not shape. Payload's upload pipeline does exactly that, through
// `file-type`, and wraps the resulting TypeError in a `ValidationError` on the `file` field. The
// consequence was that no Payload project running this config could integration-test an upload against
// an `upload.mimeTypes` allowlist: the suite reported the project's own allowlist rejecting a valid PNG,
// which is a defect in this file wearing the costume of a defect in the project's security policy.
//
// So an integration spec, which boots the server-side application and has no DOM to want, runs under
// `node`. A unit spec keeps `jsdom`: `tests/component/**` is where a spec that needs a DOM belongs, but
// a `.ts` unit spec reaching for `document` is a shape consumers already have, and taking it away is a
// different decision from this one.
const SUITES: readonly Suite[] = [
  {
    name: 'node',
    environment: 'node',
    include: ['tests/int/**/*.int.spec.ts', 'tests/int/**/*.int.spec.tsx'],
  },
  {
    name: 'jsdom',
    environment: 'jsdom',
    include: [
      'tests/unit/**/*.unit.spec.ts',
      // A component spec had no home. ploaness pins and ships React Testing Library, jest-dom,
      // user-event and a jsdom environment - a stack that exists for exactly this - while collecting
      // only `.ts` under unit and anything under int. So a project writing the component tests the
      // harness equips it for had to mislabel them as integration tests or watch them silently stop
      // running, which is what a real consumer's suite was doing when this was found.
      'tests/component/**/*.component.spec.tsx',
      'tests/component/**/*.component.spec.ts',
    ],
  },
]

// Every suite carries the guards, because a project gets its own Vite server and inherits nothing from
// the root unless it says so. The plugin is constructed per suite rather than shared: two servers
// holding one plugin instance would share whatever state it keeps.
const suiteProject = (suite: Suite): Record<string, unknown> => ({
  plugins: [react()],
  // Vite resolves the project's path aliases from tsconfig natively, so no extra plugin is needed.
  resolve: { tsconfigPaths: true },
  test: {
    name: suite.name,
    environment: suite.environment,
    include: [...suite.include],
    // The harness file first, and `sequence.setupFiles: 'list'` makes that ordering binding rather
    // than incidental: it installs the network guard, which has to be in place before a project's own
    // setup runs. A project cannot reach either entry - its vitest.config.mts is a bare re-export of
    // this file, and the `tests` gate builds its own argv.
    setupFiles: [harnessSetupFile(), ...projectSetupFiles()],
    sequence: DETERMINISTIC_SEQUENCE,
    // Run spec files one at a time. Each top-level test command gets one ephemeral database, but every
    // Payload-booting spec within that command shares it; in parallel, two boots could race to CREATE
    // the same enum or table. Serial boots make the first push establish the schema and later boots find
    // it already present, which is idempotent.
    //
    // Declared on every suite, not once at the root: Vitest collapses the suites into a single serial
    // group only when each one asks for a single worker, so a suite that omitted this would run
    // alongside the others and put the shared database back in a race.
    fileParallelism: false,
  },
})

// Structural rather than Vite's own `UserConfig`, and the annotation is load-bearing rather than
// stylistic. An emitted declaration naming `import('vite').UserConfig` would make `vite` resolvable
// from this package a condition of type-checking a consumer's `vitest.config.mts` - and `vite` arrives
// here only as a transitive dependency of `vitest`, which pnpm's strict layout does not expose. The
// consumer re-exports this value and never reads a field off it, so the shape is all it needs. The
// hand-written declaration this file replaced recorded the same decision.
// `ReturnType` rather than the runner's own exported type: naming that type would import it, which is
// the dependency the annotation below exists to avoid. This binding is module-local, so it reaches no
// declaration file either way.
const declared: ReturnType<typeof defineConfig> = defineConfig({
  test: {
    projects: SUITES.map((suite: Suite): Record<string, unknown> => suiteProject(suite)),
    // Root-only, like coverage below: a reporter reports on the run rather than on one suite.
    reporters: [...testReporters()],
    // Coverage stays at the root because Vitest forbids it anywhere else: it is one measurement over
    // the whole verification rather than a property of any one suite.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Imported rather than written here: the exclusion-reach rule judges a declared exclusion against
      // exactly this set, and a second copy of it would decide a verdict the report never agreed with.
      include: [...COVERAGE_INCLUDE],
      exclude: [...settings.coverageExclude],
      thresholds: {
        // perFile: every covered file must independently clear the bar. Without it one fully covered
        // file can mask an uncovered one in the aggregate, which is exactly how an untested helper hides.
        perFile: true,
        lines: COVERAGE_THRESHOLD,
        branches: COVERAGE_THRESHOLD,
        functions: COVERAGE_THRESHOLD,
        statements: COVERAGE_THRESHOLD,
      },
    },
  },
})

// A shallow copy rather than an assertion: a spread yields an anonymous object type, which carries
// the index signature an interface does not, so the structural annotation above holds without one.
const config: Readonly<Record<string, unknown>> = { ...declared }

export default config
