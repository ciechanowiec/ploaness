import { DETERMINISTIC_SEQUENCE, harnessSetupFile } from '@ploaness/config/vitest-core'
import { defineConfig } from 'vitest/config'

// ploaness governs itself. The governance layer is pure, so it is measured on line and branch coverage
// per file; the CLI is I/O glue over it and is exercised by the consumer fixtures in it/ instead.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.spec.ts'],
    // The harness file first, which installs the network guard; then this repository's own, which
    // carries the fast-check seed. Both halves are what a consumer receives, composed against this
    // layout rather than restated for it.
    setupFiles: [harnessSetupFile(), './vitest.setup.ts'],
    sequence: DETERMINISTIC_SEQUENCE,
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['packages/governance/src/**/*.ts'],
      exclude: ['packages/governance/src/index.ts'],
      thresholds: { perFile: true, lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
})
