import { defineConfig } from 'vitest/config'

// ploaness governs itself. The governance layer is pure, so it is measured on line and branch coverage
// per file; the CLI is I/O glue over it and is exercised by the consumer fixtures in it/ instead.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.spec.ts'],
    // The fixed fast-check seed the property specs are written against.
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['packages/governance/src/**/*.ts'],
      exclude: ['packages/governance/src/index.ts'],
      thresholds: { perFile: true, lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
})
