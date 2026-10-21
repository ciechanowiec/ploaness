// Exercise the public axe helper against real Next markup outside the customary semantic regions.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const DIRECTORY_ARGUMENT: number = 2
const directory: string | undefined = process.argv[DIRECTORY_ARGUMENT]
if (directory === undefined) {
  throw new Error('Expected the browser fixture directory')
}

const button = (id: string, isAccessible: boolean): string => {
  const label: string = isAccessible ? ` aria-label="${id}"` : ''
  return `<button id="${id}" type="button"${label}><span aria-hidden="true">Open</span></button>`
}

const page = (isAccessible: boolean): string =>
  [
    'export default function Page(): React.JSX.Element { return <>',
    '<main><h1>Document accessibility</h1></main>',
    `<nav aria-label="Actions">${button('navigation', isAccessible)}</nav>`,
    `<dialog open aria-label="Preferences">${button('dialog', isAccessible)}</dialog>`,
    `<aside aria-label="Cookie choices">${button('cookies', isAccessible)}</aside>`,
    '</> }',
    '',
  ].join('\n')

const app: string = path.join(directory, 'src/app')
mkdirSync(path.join(app, 'invalid'), { recursive: true })
writeFileSync(path.join(app, 'page.tsx'), page(true))
writeFileSync(path.join(app, 'invalid/page.tsx'), page(false))
writeFileSync(
  path.join(directory, 'tests/e2e/document.e2e.spec.ts'),
  [
    "import { expect, test } from '@playwright/test'",
    "import { expectNoAxeDefects, scopedAxe } from 'ploaness/a11y'",
    "test('reports unnamed controls throughout the document', async ({ page }) => {",
    "  await page.goto('/invalid')",
    '  const scan = await (await scopedAxe(page)).analyze()',
    "  const targets = scan.violations.filter(({ id }) => id === 'button-name')",
    '    .flatMap(({ nodes }) => nodes.flatMap(({ target }) => target))',
    "  expect(targets).toEqual(expect.arrayContaining(['#navigation', '#dialog', '#cookies']))",
    '})',
    "test('accepts named controls throughout the document', async ({ page }) => {",
    "  await page.goto('/')",
    "  expectNoAxeDefects(await (await scopedAxe(page)).analyze(), 'whole document')",
    '})',
    '',
  ].join('\n'),
)
