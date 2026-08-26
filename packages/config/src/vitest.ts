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
import { DETERMINISTIC_SEQUENCE, harnessSetupFile, projectSetupFiles } from './vitest-core.js'

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
  plugins: [react()],
  // Vite resolves the project's path aliases from tsconfig natively, so no extra plugin is needed.
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    // The harness file first, and `sequence.setupFiles: 'list'` makes that ordering binding rather
    // than incidental: it installs the network guard, which has to be in place before a project's own
    // setup runs. A project cannot reach either entry - its vitest.config.mts is a bare re-export of
    // this file, and the `tests` gate builds its own argv.
    setupFiles: [harnessSetupFile(), ...projectSetupFiles()],
    sequence: DETERMINISTIC_SEQUENCE,
    include: [
      'tests/int/**/*.int.spec.ts',
      'tests/int/**/*.int.spec.tsx',
      'tests/unit/**/*.unit.spec.ts',
    ],
    // Run spec files one at a time. Each top-level test command gets one ephemeral database, but every
    // Payload-booting spec within that command shares it; in parallel, two boots could race to CREATE
    // the same enum or table. Serial boots make the first push establish the schema and later boots find
    // it already present, which is idempotent.
    fileParallelism: false,
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
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
})

// A shallow copy rather than an assertion: a spread yields an anonymous object type, which carries
// the index signature an interface does not, so the structural annotation above holds without one.
const config: Readonly<Record<string, unknown>> = { ...declared }

export default config
