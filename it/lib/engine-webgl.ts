// Every pinned engine draws WebGL, so the engine pass judges the page a visitor's browser shows. The
// server starts with the arguments the e2e gate uses, and each engine connects as the suite does. Firefox
// draws nothing without what those arguments set up: a page asking for a WebGL context gets none, and a
// WebGL library logs the error the sweep reports.
//
// Run from the repository root after `pnpm run build`, with the pinned Playwright image present.
import { type Browser, type Page, type PinnedServer, startPinnedServer } from './pinned-server.ts'

// The one browser call the page function below makes; the lint project compiles without the DOM lib.
declare const document: { readonly createElement: (tag: 'canvas') => { getContext: (kind: string) => unknown } }

const hasWebGlInPage = (): boolean => {
  const canvas: { getContext: (kind: string) => unknown } = document.createElement('canvas')
  return (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) !== null
}

const ENGINES: readonly string[] = ['chromium', 'firefox', 'webkit']
const server: PinnedServer = await startPinnedServer('engine-webgl')

const canDrawWebGl = async (engine: string): Promise<boolean> => {
  const browser: Browser = await server.connect(engine)
  try {
    const page: Page = await browser.newPage()
    return await page.evaluate(hasWebGlInPage)
  } finally {
    await browser.close()
  }
}

try {
  const drawn: readonly (readonly [string, boolean])[] = await Promise.all(
    ENGINES.map(async (engine: string): Promise<readonly [string, boolean]> => [engine, await canDrawWebGl(engine)]),
  )
  const without: readonly string[] = drawn.filter(([, isDrawn]) => !isDrawn).map(([engine]) => engine)
  if (without.length > 0) {
    throw new Error(`The pinned engines must draw WebGL; these drew none: ${without.join(', ')}`)
  }
  console.info('every pinned engine draws WebGL')
} finally {
  server.stop()
}
