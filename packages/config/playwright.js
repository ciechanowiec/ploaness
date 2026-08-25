// The Playwright configuration ploaness owns. A consuming project re-exports it verbatim, exactly as it
// re-exports the ESLint and Vitest configs, and the wiring gate requires that re-export.
//
// Everything here is policy rather than preference. `forbidOnly` is the end-to-end analogue of the
// focused-test ban ploaness already enforces for Vitest: a left-behind `test.only` would otherwise turn
// a local extended run into one green test. A single worker is not a performance choice either - every spec shares
// one dev server that compiles routes on demand, and parallel workers starve the heavier specs against
// it. The only project-specific input is the origin, which the project declares under the `ploaness`
// key of its package.json rather than by editing this file.
import { defineConfig, devices } from '@playwright/test'
import { projectSettings } from './project-settings.js'

const isContinuousIntegration = Boolean(process.env.CI)

// The web server is `next dev`, which compiles a route on its first request. The first hit to the heavy
// Payload admin bundle can exceed the 30s Playwright default on a cold runner, so the budget gives
// compilation headroom instead of leaning on a retry to mask it.
const TEST_TIMEOUT_MS = 90_000
const SERVER_TIMEOUT_MS = 180_000
const CI_RETRIES = 2

export default defineConfig({
  testDir: './tests/e2e',
  timeout: TEST_TIMEOUT_MS,
  forbidOnly: true,
  retries: isContinuousIntegration ? CI_RETRIES : 0,
  workers: 1,
  // `open: 'never'` because the gate runs this non-interactively: a reporter that launches a browser
  // on failure would hang the run rather than report it.
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: projectSettings.serverUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }],
  webServer: {
    // Invoked as a bare binary rather than through a package script. Playwright puts the project's
    // `node_modules/.bin` on PATH, and a nested package manager spawned here inherits expectations
    // from its parent that do not hold inside a test runner.
    command: 'next dev',
    url: projectSettings.serverUrl,
    reuseExistingServer: !isContinuousIntegration,
    timeout: SERVER_TIMEOUT_MS,
    env: { NEXT_TELEMETRY_DISABLED: '1', NODE_OPTIONS: '--no-deprecation' },
  },
})
