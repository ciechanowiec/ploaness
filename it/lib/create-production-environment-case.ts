// Observe environment values captured by spec imports and rendered by the actual application.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const DIRECTORY_ARGUMENT: number = 2
const directory: string | undefined = process.argv[DIRECTORY_ARGUMENT]
if (directory === undefined) {
  throw new Error('Expected the browser fixture directory')
}
writeFileSync(path.join(directory, '.env'), 'BUILD_DIRECTORY=.generic\nENV_PRIORITY=from-generic\n')
writeFileSync(
  path.join(directory, '.env.production.local'),
  'BUILD_ROOT=.production\nBUILD_DIRECTORY=$BUILD_ROOT\nENV_PRIORITY=from-production\n',
)
const home: string = path.join(directory, 'src/app/page.tsx')
writeFileSync(
  home,
  readFileSync(home, 'utf8').replace(
    '</main>',
    (): string =>
      '<p data-testid="directory">{process.env["BUILD_DIRECTORY"]}</p>' +
      '<p data-testid="priority">{process.env["ENV_PRIORITY"]}</p></main>',
  ),
)
writeFileSync(
  path.join(directory, 'tests/e2e/environment.e2e.spec.ts'),
  [
    "import { expect, test } from '@playwright/test'",
    "const importedDirectory: string | undefined = process.env['BUILD_DIRECTORY']",
    "const importedPriority: string | undefined = process.env['ENV_PRIORITY']",
    "test('prepares the same environment for specs and application', async ({ page }) => {",
    "  const expectedDirectory: string = process.env['EXPECTED_DIRECTORY'] ?? '.production'",
    '  expect(importedDirectory).toBe(expectedDirectory)',
    "  expect(importedPriority).toBe('from-process')",
    "  await page.goto('/')",
    "  await expect(page.getByTestId('directory')).toHaveText(expectedDirectory)",
    "  await expect(page.getByTestId('priority')).toHaveText('from-process')",
    '})',
    '',
  ].join('\n'),
)
