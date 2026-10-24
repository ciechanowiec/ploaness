// Real Next pages and stories for the change-scope contracts: two routes, of which only `/alpha` imports
// the badge component, and an auxiliary server answering the Storybook contract with two stories, of
// which only the badge story's file imports it. A change to the badge must therefore reach `/alpha` and
// the badge story, and nothing else.
//
// Run after `create-a11y-page.ts`, which gives the case its server address, root layout and Next
// configuration.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import path from 'node:path'
import { asRecord } from '@ploaness/governance'

const ARGUMENT_OFFSET: number = 2

const [directory]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (directory === undefined) {
  throw new Error('Expected a fixture directory')
}

const JSON_INDENT: number = 2

const freePort = async (): Promise<number> => {
  const server: Server = createServer()
  await new Promise<void>((resolve, reject): void => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address: ReturnType<Server['address']> = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('The story fixture did not receive a TCP port')
  }
  await new Promise<void>((resolve): void => {
    server.close((): void => {
      resolve()
    })
  })
  return address.port
}

const writeModule = (file: string, source: string): void => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, source)
}

const page = (heading: string, body: string, imports: readonly string[] = []): string =>
  [
    ...imports,
    '',
    'export default function Page(): React.JSX.Element {',
    `  return <main><h1>${heading}</h1>${body}</main>`,
    '}',
    '',
  ].join('\n')

const component = (name: string, text: string): string =>
  [`export function ${name}(): React.JSX.Element {`, `  return <p>${text}</p>`, '}', ''].join('\n')

const story = (name: string, module: string): string =>
  [
    `import { ${name} } from './${module}'`,
    '',
    `export default { title: 'Fixture/${name}', component: ${name} }`,
    '',
    'export const Default = {}',
    '',
  ].join('\n')

const storyServer = (port: number): string => `import { createServer } from 'node:http'

const entry = (name, file) => ({
  type: 'story',
  id: 'fixture-' + name + '--default',
  title: 'Fixture/' + name,
  name: 'Default',
  importPath: './src/' + file + '.stories.tsx',
})
const index = { v: 5, entries: { badge: entry('badge', 'badge'), other: entry('other', 'other') } }
const preview = '<!doctype html><html lang="en"><head><title>Story</title></head>' +
  '<body><main><h1>Story</h1><p>Story text</p></main>' +
  '<script>window.__STORYBOOK_PREVIEW__ = { currentRender: { phase: "finished" } }</script></body></html>'
createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/index.json') {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(index))
  } else if (url.pathname === '/iframe.html' || url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html' }).end(preview)
  } else {
    response.writeHead(404).end()
  }
}).listen(${String(port)}, '127.0.0.1')
`

const appRoot: string = path.join(directory, 'src', 'app')
writeModule(
  path.join(appRoot, 'page.tsx'),
  page('Scope contract', '<ul><li><a href="/alpha">Alpha</a></li><li><a href="/beta">Beta</a></li></ul>'),
)
writeModule(path.join(appRoot, 'alpha', 'page.tsx'), page('Alpha', '<Badge />', ["import { Badge } from '@/badge'"]))
writeModule(path.join(appRoot, 'beta', 'page.tsx'), page('Beta', '<p>No badge here</p>'))
writeModule(path.join(directory, 'src', 'badge.tsx'), component('Badge', 'Badge'))
writeModule(path.join(directory, 'src', 'other.tsx'), component('Other', 'Other'))
writeModule(path.join(directory, 'src', 'badge.stories.tsx'), story('Badge', 'badge'))
writeModule(path.join(directory, 'src', 'other.stories.tsx'), story('Other', 'other'))
const storyPort: number = await freePort()
writeModule(path.join(directory, 'story-server.mjs'), storyServer(storyPort))
const manifestPath: string = path.join(directory, 'package.json')
const manifest: Record<string, unknown> = asRecord(JSON.parse(readFileSync(manifestPath, 'utf8')))
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      ...manifest,
      ploaness: {
        ...asRecord(manifest['ploaness']),
        auxiliaryServers: [{ command: 'node story-server.mjs', url: `http://127.0.0.1:${String(storyPort)}` }],
      },
    },
    null,
    JSON_INDENT,
  )}\n`,
)
