// Real Next pages for the layout scan's contracts, each holding one defect or its repair. The pinned
// sweep crawls them from the home page in the pinned browser; nothing measures or judges on their behalf.
//
// Run after `create-a11y-page.ts`, which gives the case its server address, root layout and Next
// configuration; this replaces its page with a home page linking to the pages below.
//
// `defects` holds one page per rule, the stale and unexplained exemptions, and the clean pages that must
// stay silent beside them. `repaired` holds the same markup laid out correctly, plus a dynamic route its
// own spec covers with the combined helper. `unmeasured` holds a dynamic route scanned with axe alone.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ARGUMENT_OFFSET: number = 2

type Mode = 'defects' | 'repaired' | 'unmeasured'

const MODES: readonly Mode[] = ['defects', 'repaired', 'unmeasured']

const MODE_NAMES: ReadonlySet<string> = new Set<string>(MODES)

const isMode = (value: string | undefined): value is Mode => MODE_NAMES.has(value ?? '')

// The email confirmation page that escaped every other gate, as the consuming project wrote it.
const verifyPage = (pageClass: string): string => `
<div className="${pageClass}">
  <div className="page-heading"><h1>Email confirmation</h1></div>
  <div className="notice notice-success" role="status"><p>Your email address is confirmed.</p></div>
  <p className="inline-actions"><a className="button" href="/">Sign in</a></p>
</div>`

const tabs = (groupClass: string, attributes: string): string => `
<div className="${groupClass}">
  <div className="tablist" ${attributes}>Fixtures</div>
  <div className="panel"><p>Saturday, three matches.</p></div>
</div>`

const ATTACHED: string = 'data-ploaness-layout="attached" data-ploaness-layout-reason="the tab list joins its panel"'

const CLEAN: string = '<p>Nothing on this page touches anything else.</p>'

const CLOSED_DISCLOSURE: string = `
<div><details><summary><span>Show details</span></summary>
Hidden direct text before the nested content.
<p class="overlap-body">Hidden body text</p>
<details open><summary>Inner disclosure</summary><p class="overlap-body">Hidden inner text</p></details>
<summary>Hidden second summary</summary>
<div class="wide">Hidden wide content</div>
</details><p>Visible following text</p></div>`

const OPEN_DISCLOSURE: string = `
<details open><summary>Show details</summary><p>Visible body text</p>
<details><summary>Inner disclosure</summary>Hidden direct inner text
<p class="overlap-body">Hidden inner body</p></details></details>`

const DEFECT_PAGES: Readonly<Record<string, string>> = {
  verify: verifyPage('page page-narrow'),
  'text-overlap':
    '<div><h2 className="overlap-title">Results</h2><p className="overlap-body">Saturday fixtures</p></div>',
  overflow: '<div className="wide">Wide fixture table</div>',
  clipped: '<p><span className="clipped">Borussia Mönchengladbach</span></p>',
  truncated: '<p><span className="truncated">Borussia Mönchengladbach</span></p>',
  stale: tabs('tabs apart', ATTACHED),
  unexplained: tabs('tabs', 'data-ploaness-layout="attached"'),
  attached: tabs('tabs', ATTACHED),
  clean: CLEAN,
  'closed-disclosure': CLOSED_DISCLOSURE,
  'open-disclosure': OPEN_DISCLOSURE,
  'open-disclosure-overlap':
    '<details open><summary>Visible summary</summary><p class="overlap-body">Visible body overlap</p></details>',
  'closed-summary-overlap': `<div>
<details><summary><span>Visible summary</span></summary>Hidden body</details>
<p class="overlap-body">Visible neighbor</p></div>`,
  'closed-disclosure-box': `<div>
<details class="notice"><summary>Visible summary</summary>Hidden body</details>
<a class="button" href="/">Continue</a></div>`,
}

const REPAIRED_PAGES: Readonly<Record<string, string>> = {
  verify: verifyPage('page page-narrow spaced'),
  truncated: '<p><span className="truncated" title="Borussia Mönchengladbach">Borussia Mönchengladbach</span></p>',
  attached: tabs('tabs', ATTACHED),
  clean: CLEAN,
  'closed-disclosure': CLOSED_DISCLOSURE,
  'open-disclosure': OPEN_DISCLOSURE,
}

const STYLES: string = `
body { margin: 0; background: #ffffff; color: #111827; font-family: sans-serif; }
main { display: flex; flex-direction: column; gap: 24px; padding: 16px; }
h1, h2, p { margin: 0; }
.page { display: flex; flex-direction: column; }
.page.spaced { gap: 16px; }
.notice { background: #ecfdf5; border-left: 4px solid #15803d; padding: 8px 12px; }
.button { display: inline-block; background: #b91c1c; color: #ffffff; padding: 8px 16px; }
.wide { width: 600px; }
.overlap-body { margin-top: -1em; }
.clipped, .truncated { display: block; width: 80px; overflow: hidden; white-space: nowrap; }
.truncated { text-overflow: ellipsis; }
.tabs { display: flex; flex-direction: column; }
.tabs.apart { gap: 16px; }
.tablist { background: #dbeafe; padding: 8px; }
.panel { background: #eff6ff; padding: 16px; }
`

const pageModule = (heading: string, body: string): string =>
  [
    'export default function Page(): React.JSX.Element {',
    `  return <main><h1>${heading}</h1>${body}</main>`,
    '}',
    '',
  ].join('\n')

// The home page only links, so the crawl reaches every page and the home page itself stays clean.
const linkItem = (route: string): string => `<li><a href="/${route}">${route}</a></li>`

const homeModule = (routes: readonly string[]): string =>
  pageModule('Layout contract', `<ul>${routes.map((route: string): string => linkItem(route)).join('')}</ul>`)

// The verify page carries its own heading, so it is written without the wrapper's.
const routeModule = (route: string, body: string): string =>
  route === 'verify'
    ? ['export default function Page(): React.JSX.Element {', `  return <main>${body}</main>`, '}', ''].join('\n')
    : pageModule(route, body)

const ITEM_MODULE: string = [
  'export default async function Page({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {',
  '  const { id } = await params',
  '  return <main><h1>Item {id}</h1><p>An item no page links to.</p></main>',
  '}',
  '',
].join('\n')

// The generated specs build the item address with a template literal, as a project's spec would. The
// placeholder is assembled so this file does not read as one that forgot to interpolate.
const DOLLAR: string = '$'
const ITEM_GOTO: string = ['  await page.goto(`/items/', DOLLAR, '{id}`)'].join('')

const ITEM_SPECS: Readonly<Record<Exclude<Mode, 'defects'>, string>> = {
  repaired: [
    "import { test } from '@playwright/test'",
    "import { expectSweptPage } from 'ploaness/a11y'",
    '',
    "test('an item page passes both scans', async ({ page }) => {",
    "  const id: string = '7'",
    ITEM_GOTO,
    '  await expectSweptPage(page)',
    '})',
    '',
  ].join('\n'),
  unmeasured: [
    "import AxeBuilder from '@axe-core/playwright'",
    "import { expect, test } from '@playwright/test'",
    '',
    "test('an item page passes axe', async ({ page }) => {",
    "  const id: string = '7'",
    ITEM_GOTO,
    '  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])',
    '})',
    '',
  ].join('\n'),
}

const writeModule = (file: string, source: string): void => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, source)
}

const writePages = (directory: string, pages: Readonly<Record<string, string>>): void => {
  const appRoot: string = path.join(directory, 'src', 'app')
  writeModule(path.join(appRoot, 'page.tsx'), homeModule(Object.keys(pages)))
  for (const [route, body] of Object.entries(pages)) {
    writeModule(path.join(appRoot, route, 'page.tsx'), routeModule(route, body))
  }
  writeModule(path.join(appRoot, 'globals.css'), STYLES)
}

const [directory, mode]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (directory === undefined || !isMode(mode)) {
  throw new Error(`Expected a fixture directory and one of: ${MODES.join(', ')}`)
}
writePages(directory, mode === 'defects' ? DEFECT_PAGES : REPAIRED_PAGES)
if (mode !== 'defects') {
  writeModule(path.join(directory, 'src', 'app', 'items', '[id]', 'page.tsx'), ITEM_MODULE)
  writeModule(path.join(directory, 'tests', 'e2e', 'items.e2e.spec.ts'), ITEM_SPECS[mode])
}
