// A real Next page for the shipped browser sweep's positive and negative contracts. No API,
// accessibility scanner, or browser is replaced; the only difference is the page's accessible names.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import path from 'node:path'
import { asRecord } from '@ploaness/governance'

const ARGUMENT_OFFSET: number = 2

const freePort = async (): Promise<number> => {
  const server: Server = createServer()
  await new Promise<void>((resolve, reject): void => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address: ReturnType<Server['address']> = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('The browser fixture did not receive a TCP port')
  }
  await new Promise<void>((resolve, reject): void => {
    server.close((error: Error | undefined): void => {
      if (error === undefined) {
        resolve()
      } else {
        reject(error)
      }
    })
  })
  return address.port
}

const pageSource = (isAccessible: boolean): string =>
  [
    'export default function Page(): React.JSX.Element {',
    '  return <main><h1>Accessibility contract</h1>',
    isAccessible
      ? '    <label htmlFor="name">Name</label><input id="name" type="text" />'
      : '    <input type="text" />',
    `    <button type="button"${isAccessible ? ' aria-label="Close"' : ''}>`,
    '      <span aria-hidden="true">Close</span>',
    '    </button></main>',
    '}',
    '',
  ].join('\n')

const [directory, mode]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (directory === undefined || !['valid', 'invalid'].includes(mode ?? '')) {
  throw new Error('Expected a fixture directory and valid or invalid markup mode')
}
const JSON_INDENT: number = 2
const manifestPath: string = path.join(directory, 'package.json')
const manifest: Record<string, unknown> = asRecord(JSON.parse(readFileSync(manifestPath, 'utf8')))
const port: number = await freePort()
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      ...manifest,
      ploaness: {
        ...asRecord(manifest['ploaness']),
        serverUrl: `http://127.0.0.1:${String(port)}`,
      },
    },
    null,
    JSON_INDENT,
  )}\n`,
)
const appRoot: string = path.join(directory, 'src', 'app')
mkdirSync(appRoot, { recursive: true })
writeFileSync(path.join(appRoot, 'page.tsx'), pageSource(mode === 'valid'))
writeFileSync(
  path.join(appRoot, 'layout.tsx'),
  [
    "import './globals.css'",
    "export const metadata = { title: 'Accessibility contract' }",
    'export default function Layout({ children }: { children: React.ReactNode }): React.JSX.Element {',
    '  return <html lang="en"><body>{children}</body></html>',
    '}',
    '',
  ].join('\n'),
)
writeFileSync(
  path.join(appRoot, 'globals.css'),
  [
    'body { background: white; color: black; font-family: sans-serif; }',
    'main { padding: 2rem; }',
    'input, button { display: block; min-width: 100px; min-height: 32px; margin: 24px; }',
    '',
  ].join('\n'),
)

// Fixture cases share their installed packages with a sibling template. Turbopack must see both.
writeFileSync(
  path.join(directory, 'next.config.ts'),
  `export default { turbopack: { root: ${JSON.stringify(path.dirname(directory))} } }\n`,
)
