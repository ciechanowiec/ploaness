// Real Next pages for the browser sweep's rule contracts: one page per rule holding its defect, or the
// same page repaired. The pinned sweep discovers and judges them; nothing measures on their behalf.
//
// Run after `create-a11y-page.ts`, which gives the case its server address, root layout and Next
// configuration. Beside the pages this writes a sitemap listing a page nothing links to, a page reached
// only through an `hreflang` alternate, and an auxiliary server answering the Storybook contract the
// sweep reads - `/index.json` and a preview that reports its render phase - with one story.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { asRecord } from '@ploaness/governance'

const ARGUMENT_OFFSET: number = 2

const [directory, mode]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (directory === undefined || (mode !== 'defects' && mode !== 'valid')) {
  throw new Error('Expected a fixture directory and defects or valid mode')
}

type Mode = 'defects' | 'valid'

const JSON_INDENT: number = 2

// A raster source of a known natural size, so the image rules judge real decoding rather than a stub.
const PHOTO_WIDTH: number = 160
const PHOTO_HEIGHT: number = 120
const BYTE: number = 256
const CRC_POLYNOMIAL: number = 0xed_b8_83_20
const CRC_BITS: number = 8
const CRC_INITIAL: number = 0xff_ff_ff_ff
const BIT_DEPTH: number = 8
const TRUE_COLOUR: number = 2
const WORD_BYTES: number = 4
const HEADER_BYTES: number = 13
const DEPTH_OFFSET: number = 8
const COLOUR_OFFSET: number = 9
const PNG_SIGNATURE: Buffer = Buffer.from('89504e470d0a1a0a', 'hex')
const PHOTO_SHADE: Buffer = Buffer.from('2563eb', 'hex')

const CRC_TABLE: readonly number[] = Array.from({ length: BYTE }, (_unused: unknown, index: number): number =>
  Array.from({ length: CRC_BITS }).reduce<number>(
    (value: number): number => ((value & 1) === 1 ? CRC_POLYNOMIAL ^ (value >>> 1) : value >>> 1),
    index,
  ),
)

const crc32 = (bytes: Buffer): number =>
  (bytes.reduce(
    (crc: number, byte: number): number => (CRC_TABLE[(crc ^ byte) & (BYTE - 1)] ?? 0) ^ (crc >>> CRC_BITS),
    CRC_INITIAL,
  ) ^
    CRC_INITIAL) >>>
  0

const chunk = (type: string, data: Buffer): Buffer => {
  const typed: Buffer = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const length: Buffer = Buffer.alloc(WORD_BYTES)
  length.writeUInt32BE(data.length)
  const checksum: Buffer = Buffer.alloc(WORD_BYTES)
  checksum.writeUInt32BE(crc32(typed))
  return Buffer.concat([length, typed, checksum])
}

const photo = (): Buffer => {
  const header: Buffer = Buffer.alloc(HEADER_BYTES)
  header.writeUInt32BE(PHOTO_WIDTH, 0)
  header.writeUInt32BE(PHOTO_HEIGHT, WORD_BYTES)
  header.writeUInt8(BIT_DEPTH, DEPTH_OFFSET)
  header.writeUInt8(TRUE_COLOUR, COLOUR_OFFSET)
  // Each row opens with filter type 0, then the same shade in every pixel.
  const row: Buffer = Buffer.concat([
    Buffer.alloc(1),
    ...Array.from({ length: PHOTO_WIDTH }, (): Buffer => PHOTO_SHADE),
  ])
  const pixels: Buffer = Buffer.concat(Array.from({ length: PHOTO_HEIGHT }, (): Buffer => row))
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

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

interface Variant {
  readonly defect: string
  readonly valid: string
}

// Each page's body in both modes. The valid body is the same markup repaired, never a different page.
const PAGES: Readonly<Record<string, Variant>> = {
  'small-text': { defect: '<p className="tiny">Fine print</p>', valid: '<p className="legible">Fine print</p>' },
  'image-load': {
    defect: '<img src="/missing.png" alt="Missing photo" width={40} height={40} />',
    valid: '<img src="/photo.png" alt="Photo" width={160} height={120} />',
  },
  'image-distorted': {
    defect: '<img src="/photo.png" alt="Stretched photo" width={160} height={60} />',
    valid: '<img src="/photo.png" alt="Cropped photo" width={160} height={60} className="cover" />',
  },
  'image-upscaled': {
    defect: '<img src="/photo.png" alt="Enlarged photo" width={240} height={180} />',
    valid:
      '<div data-ploaness-layout="image-upscaled" data-ploaness-layout-reason="the fixture shows its only source">' +
      '<img src="/photo.png" alt="Enlarged photo" width={240} height={180} /></div>',
  },
  'media-space': {
    defect: '<img src="/photo.png" alt="Unsized photo" className="fluid" />',
    valid: '<img src="/photo.png" alt="Sized photo" className="fluid" width={160} height={120} />',
  },
  'font-load': { defect: '<p className="broken-font">Display text</p>', valid: '<p>Display text</p>' },
  'page-error': { defect: '<Complaint />', valid: '<p>Nothing to complain about.</p>' },
  'focus-visible': {
    defect: '<button type="button" className="no-ring">Silent focus</button>',
    valid: '<button type="button">Visible focus</button>',
  },
  obscured: {
    defect: '<div className="covered"><a href="/">Covered link</a><div className="overlay"></div></div>',
    valid: '<div className="covered"><a href="/">Reachable link</a></div>',
  },
  'disclosure-keyboard': { defect: '<Menu closesOnEscape={false} />', valid: '<Menu closesOnEscape={true} />' },
  'text-spacing': {
    defect: '<p className="fixed-line">Fixture line</p>',
    valid: '<p className="growing-line">Fixture line</p>',
  },
  'text-resize': {
    defect: '<p><span className="narrow-label">Short label</span></p>',
    valid: '<p><span className="wrapping-label">Short label</span></p>',
  },
  unstable: { defect: '<Grow />', valid: '<p>Holding still.</p>' },
  sweep: { defect: '<div className="band">Band</div>', valid: '<div className="band fluid-band">Band</div>' },
  night: { defect: '<p className="night">Night text</p>', valid: '<p className="night readable">Night text</p>' },
  'stale-exemption': {
    defect:
      '<p data-ploaness-layout="small-text" data-ploaness-layout-reason="the note is set small on purpose">Note</p>',
    valid: '<p>Note</p>',
  },
  locale: {
    defect: '<link rel="alternate" hrefLang="pl" href="/pl-locale" /><p>English</p>',
    valid: '<link rel="alternate" hrefLang="pl" href="/pl-locale" /><p>English</p>',
  },
}

// Pages nothing links to, reached only through the sitemap or an alternate.
const UNLINKED: Readonly<Record<string, Variant>> = {
  'from-sitemap': {
    defect: '<p className="tiny">Listed only in the sitemap</p>',
    valid: '<p>Listed only in the sitemap</p>',
  },
  'pl-locale': { defect: '<p className="tiny">Polski</p>', valid: '<p>Polski</p>' },
}

const STYLES: string = `
body { margin: 0; background: #ffffff; color: #111827; font-family: sans-serif; }
main { display: flex; flex-direction: column; gap: 24px; padding: 16px; }
h1, p { margin: 0; }
.tiny { font-size: 10px; }
.legible { font-size: 12px; }
.cover { object-fit: cover; }
.fluid { width: 100%; max-width: 160px; height: auto; }
@font-face { font-family: Broken; src: url('/missing.woff2') format('woff2'); }
.broken-font { font-family: Broken, sans-serif; }
.no-ring:focus, .no-ring:focus-visible { outline: none; }
.covered { position: relative; }
.overlay { position: absolute; inset: 0; background: #ffffff; }
.fixed-line { height: 20px; line-height: 20px; overflow: hidden; }
.growing-line { min-height: 20px; line-height: 20px; }
.narrow-label { display: block; width: 140px; white-space: nowrap; overflow: hidden; }
.wrapping-label { display: block; width: 140px; }
.band { width: 500px; background: #dbeafe; }
.fluid-band { width: auto; max-width: 500px; }
@media (max-width: 480px) { .band { width: auto; } }
.night { color: #111827; }
@media (prefers-color-scheme: dark) {
  .night { color: #333333; background: #222222; }
  .night.readable { color: #f9fafb; }
}
.growth { overflow: hidden; width: 300px; }
.growth div { height: 20px; background: #dbeafe; }
.menu { display: flex; flex-direction: column; gap: 8px; }
`

const COMPLAINT: string = `'use client'
import { useEffect } from 'react'

export function Complaint(): React.JSX.Element {
  useEffect((): void => {
    console.error('fixture page error')
  }, [])
  return <p>This page logs an error.</p>
}
`

const GROW: string = `'use client'
import { useEffect, useState } from 'react'

export function Grow(): React.JSX.Element {
  const [width, setWidth] = useState(100)
  useEffect((): (() => void) => {
    const timer = setInterval((): void => {
      setWidth((current: number): number => 100 + ((current - 90) % 1000))
    }, 16)
    return (): void => clearInterval(timer)
  }, [])
  return <div className="growth"><div style={{ width }} /></div>
}
`

const MENU: string = [
  "'use client'",
  "import { useRef, useState } from 'react'",
  '',
  'export function Menu({ closesOnEscape }: { closesOnEscape: boolean }): React.JSX.Element {',
  '  const [isOpen, setOpen] = useState(false)',
  '  const button = useRef<HTMLButtonElement>(null)',
  '  return (',
  '    <div',
  '      className="menu"',
  '      onKeyDown={(event): void => {',
  "        if (closesOnEscape && event.key === 'Escape') {",
  '          setOpen(false)',
  '          button.current?.focus()',
  '        }',
  '      }}',
  '    >',
  '      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={isOpen} onClick={(): void => setOpen(!isOpen)}>',
  '        Options',
  '      </button>',
  '      {isOpen ? (',
  '        <ul role="menu" aria-label="Options">',
  '          <li role="menuitem" tabIndex={-1}>Rename</li>',
  '        </ul>',
  '      ) : null}',
  '    </div>',
  '  )',
  '}',
  '',
].join('\n')

const SITEMAP_ROUTE: string = `export function GET(request: Request): Response {
  const origin: string = new URL(request.url).origin
  const body: string =
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    '<url><loc>' + origin + '/from-sitemap</loc></url></urlset>'
  return new Response(body, { headers: { 'content-type': 'application/xml' } })
}
`

const storyServer = (port: number, mode: Mode): string => {
  const text: string = mode === 'defects' ? '<p style="font-size:10px">Tiny story text</p>' : '<p>Story text</p>'
  return `import { createServer } from 'node:http'

const index = { v: 5, entries: { 'fixture-story--default': { type: 'story', id: 'fixture-story--default', title: 'Fixture/Story', name: 'Default' } } }
const preview = '<!doctype html><html lang="en"><head><title>Story</title></head><body><main><h1>Story</h1>${text}</main>' +
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
}

const writeModule = (file: string, source: string | Buffer): void => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, source)
}

const COMPONENTS: readonly string[] = ['Complaint', 'Grow', 'Menu']

// Each page imports only the client components it renders, as the compiler requires.
const importsOf = (body: string): readonly string[] =>
  COMPONENTS.filter((name: string): boolean => body.includes(`<${name}`)).map(
    (name: string): string => `import { ${name} } from '@/${name.toLowerCase()}'`,
  )

const pageModule = (heading: string, body: string): string =>
  [
    ...importsOf(body),
    '',
    'export default function Page(): React.JSX.Element {',
    `  return <main><h1>${heading}</h1>${body}</main>`,
    '}',
    '',
  ].join('\n')

// The obscured-focus page carries a fixed header over the top of its content in the defect mode.
const pinnedModule = (mode: Mode): string =>
  [
    'export default function Page(): React.JSX.Element {',
    '  return <>',
    '    <header className="pinned">Pinned bar</header>',
    `    <main className="${mode === 'defects' ? 'under' : 'clear'}"><a href="/">Hidden link</a><h1>Focus obscured</h1></main>`,
    '  </>',
    '}',
    '',
  ].join('\n')

const PINNED_STYLES: string = `
.pinned { position: fixed; top: 0; left: 0; right: 0; height: 120px; background: #ffffff; color: #111827; }
.under { padding-top: 16px; }
.clear { padding-top: 140px; }
`

const appRoot: string = path.join(directory, 'src', 'app')
const linked: readonly string[] = [...Object.keys(PAGES), 'focus-obscured', ...(mode === 'defects' ? ['nowhere'] : [])]
const linkItem = (route: string): string => `<li><a href="/${route}">${route}</a></li>`
writeModule(
  path.join(appRoot, 'page.tsx'),
  pageModule('Visual contract', `<ul>${linked.map((route: string): string => linkItem(route)).join('')}</ul>`),
)
const everyPage: readonly (readonly [string, Variant])[] = Object.entries({ ...PAGES, ...UNLINKED })
for (const [route, variant] of everyPage) {
  writeModule(
    path.join(appRoot, route, 'page.tsx'),
    pageModule(route, mode === 'defects' ? variant.defect : variant.valid),
  )
}
writeModule(path.join(appRoot, 'focus-obscured', 'page.tsx'), pinnedModule(mode))
writeModule(path.join(appRoot, 'sitemap.xml', 'route.ts'), SITEMAP_ROUTE)
writeModule(path.join(directory, 'src', 'complaint.tsx'), COMPLAINT)
writeModule(path.join(directory, 'src', 'grow.tsx'), GROW)
writeModule(path.join(directory, 'src', 'menu.tsx'), MENU)
writeModule(
  path.join(appRoot, 'globals.css'),
  `${readFileSync(path.join(appRoot, 'globals.css'), 'utf8')}${STYLES}${PINNED_STYLES}`,
)
writeModule(path.join(directory, 'public', 'photo.png'), photo())
const storyPort: number = await freePort()
writeModule(path.join(directory, 'story-server.mjs'), storyServer(storyPort, mode))
const manifestPath: string = path.join(directory, 'package.json')
const manifest: Record<string, unknown> = asRecord(JSON.parse(readFileSync(manifestPath, 'utf8')))
const settings: Record<string, unknown> = asRecord(manifest['ploaness'])
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      ...manifest,
      ploaness: {
        ...settings,
        auxiliaryServers: [{ command: 'node story-server.mjs', url: `http://127.0.0.1:${String(storyPort)}` }],
      },
    },
    null,
    JSON_INDENT,
  )}\n`,
)
