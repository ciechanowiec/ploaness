// The Playwright configuration ploaness owns. A consuming project re-exports it verbatim, exactly as it
// re-exports the ESLint and Vitest configs, and the wiring gate requires that re-export.
//
// Everything here is policy rather than preference. `forbidOnly` is the end-to-end analogue of the
// focused-test ban ploaness already enforces for Vitest: a left-behind `test.only` would otherwise turn
// a local extended run into one green test. A single worker is not a performance choice either - every spec shares
// one dev server that compiles routes on demand, and parallel workers starve the heavier specs against
// it. The project-specific inputs are the origin and any server its own specs need started beside the
// application, both declared under the `ploaness` key of its package.json rather than by editing this
// file. Neither reaches a rule: they say where the application answers and what else has to be running,
// and every threshold, ban and pinned spec above is the same whatever they say.
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
  // The application under test first, then whatever the project's own specs also need running. A
  // declared server is ADDED here rather than substituted: `baseURL` above still points at the
  // application, so the pinned accessibility sweep drives the same origin whatever a project declares.
  // Without this a project had no way to say so at all, because the wiring gate requires
  // playwright.config.ts to be a bare re-export of this file.
  webServer: [
    {
      // Invoked as a bare binary rather than through a package script. Playwright puts the project's
      // `node_modules/.bin` on PATH, and a nested package manager spawned here inherits expectations
      // from its parent that do not hold inside a test runner.
      command: 'next dev',
      url: projectSettings.serverUrl,
      reuseExistingServer: !isContinuousIntegration,
      timeout: SERVER_TIMEOUT_MS,
      env: { NEXT_TELEMETRY_DISABLED: '1', NODE_OPTIONS: '--no-deprecation' },
    },
    // The same budget and the same reuse rule as the application: an auxiliary server is started by the
    // same runner on the same cold machine, so a shorter one would fail for the reason that one is long.
    ...projectSettings.auxiliaryServers.map((server) => ({
      command: server.command,
      url: server.url,
      reuseExistingServer: !isContinuousIntegration,
      timeout: SERVER_TIMEOUT_MS,
      env: { NODE_OPTIONS: '--no-deprecation' },
    })),
  ],
})
