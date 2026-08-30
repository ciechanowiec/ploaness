import {
  DETERMINISTIC_SEQUENCE,
  harnessSetupFile,
  testReporters,
} from '@ploaness/config/vitest-core'
import { defineConfig } from 'vitest/config'

// ploaness governs itself. The governance layer is pure, so it is measured on line and branch coverage
// per file; the CLI is I/O glue over it and is exercised by the consumer fixtures in it/ instead.
//
// `packages/runtime` is measured on the same terms and for the same reason: it is pure. It is a
// separate package because a consumer's `src/**` must be able to import it (see its own header), not
// because it is a different KIND of code, so moving a module there must not move it out of the floor.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.spec.ts'],
    // The harness file first, which installs the network guard; then this repository's own, which
    // carries the fast-check seed. Both halves are what a consumer receives, composed against this
    // layout rather than restated for it.
    setupFiles: [harnessSetupFile(), './vitest.setup.ts'],
    sequence: DETERMINISTIC_SEQUENCE,
    reporters: [...testReporters()],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['packages/governance/src/**/*.ts', 'packages/runtime/src/**/*.ts'],
      exclude: ['packages/governance/src/index.ts', 'packages/runtime/src/index.ts'],
      thresholds: { perFile: true, lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
})
