// The Vitest configuration for a member that serves no application.
//
// Two differences from the application configuration, both about what is absent rather than about what
// is relaxed: the environment is node, because a package with no browser has no DOM to simulate and
// paying for jsdom on every file would be waste; and the React plugin is not loaded, because a package
// with no components has nothing for it to transform. The coverage floors, the deterministic sequence
// and the network guard are the same ones an application is held to.
import { COVERAGE_INCLUDE } from '@ploaness/governance'
import { defineConfig } from 'vitest/config'
import { projectSettings as settings } from './project-settings.js'
import {
  COVERAGE_THRESHOLD,
  DETERMINISTIC_SEQUENCE,
  harnessSetupFile,
  projectSetupFiles,
} from './vitest-core.js'

const declared: ReturnType<typeof defineConfig> = defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.unit.spec.ts', 'tests/int/**/*.int.spec.ts'],
    setupFiles: [harnessSetupFile(), ...projectSetupFiles()],
    sequence: DETERMINISTIC_SEQUENCE,
    coverage: {
      provider: 'v8',
      include: [...COVERAGE_INCLUDE],
      exclude: [...settings.coverageExclude],
      thresholds: {
        perFile: true,
        lines: COVERAGE_THRESHOLD,
        branches: COVERAGE_THRESHOLD,
        functions: COVERAGE_THRESHOLD,
        statements: COVERAGE_THRESHOLD,
      },
    },
  },
})

// Structural, for the reason the application configuration records: naming Vite's own type would make
// `vite` resolvable from this package a condition of type-checking a consumer's config file.
const config: Readonly<Record<string, unknown>> = { ...declared }

export default config
