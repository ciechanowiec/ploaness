// Browser regressions for motion, ancestor clipping, error layouts and actually executed scans.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ARGUMENT_OFFSET: number = 2
const [directory, mode]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (directory === undefined || !['defects', 'valid', 'unexecuted'].includes(mode ?? '')) {
  throw new Error('Expected a fixture directory and defects, valid or unexecuted mode')
}
const app: string = path.join(directory, 'src/app')
const writePage = (route: string, source: string): void => {
  const folder: string = path.join(app, route)
  mkdirSync(folder, { recursive: true })
  writeFileSync(path.join(folder, 'page.tsx'), `${source}\n`)
}
const layout: string = path.join(app, 'layout.tsx')
writeFileSync(
  layout,
  readFileSync(layout, 'utf8').replace('<body>{children}</body>', '<body><main>{children}</main></body>'),
)
writePage(
  '',
  `export default function Page() { return <><h1>Browser contracts</h1>
<nav aria-label="Examples" style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
<a href="/motion">Motion</a><a href="/clipping">Clipping</a><a href="/keyboard">Keyboard</a>
<a href="/pointer">Pointer</a><a href="/whitespace">Whitespace</a></nav></> }`,
)
writePage(
  'whitespace',
  `export default function Page() { return <><h1>Preserved whitespace</h1>
  <div style={{ width: 160, overflow: 'hidden' }}>
  <p style={{ whiteSpace: 'pre-wrap', fontSize: 32 }}>{'Text' + ' '.repeat(24)}</p>
  </div></> }`,
)
writePage(
  'clipping',
  `export default function Page() { return <><h1>Ancestor clipping</h1>
<div style={{ height: ${mode === 'defects' ? '100' : '200'}, overflow: 'hidden' }}>
<p style={{ marginTop: 120 }}>Content below the clipping edge</p></div>
<div tabIndex={0} role="region" aria-label="Scrollable example" style={{ height: 100, overflow: 'auto' }}>
<p style={{ marginTop: 120 }}>Scrollable content</p></div></> }`,
)
writeFileSync(
  path.join(app, 'not-found.tsx'),
  mode === 'defects'
    ? 'export default function Missing() { return <main><h1>Missing page</h1></main> }\n'
    : 'export default function Missing() { return <><h1>Missing page</h1><a href="/">Home</a></> }\n',
)
writePage(
  'keyboard',
  `"use client"
import { useState } from 'react'
export default function Page() {
  const [opened, setOpened] = useState(false)
  return <><h1>Keyboard activation</h1>
  <button type="button" {...{ 'aria-expanded': opened }} aria-controls="panel" onClick={(event) => {
    if (event.detail ${mode === 'defects' ? '>' : '>='} 0) setOpened(!opened)
  }}>Open panel</button>
  <div id="panel" hidden={!opened}><p>Panel contents</p></div>
  <button type="button" disabled aria-haspopup="dialog">Unavailable action</button></>
}
`,
)
writePage('private', 'export default function Page() { return <h1>Unlinked account</h1> }')
writePage(
  'pointer',
  `"use client"
export default function Page() { return <><h1>Moving controls</h1>
  <button type="button" className="moving-control">Moving action</button>
  <div className="clipped-frame"><button type="button" className="sliding-control" onFocus={(event) => {
    if (window.matchMedia('(prefers-reduced-motion: no-preference)').matches)
      event.currentTarget.style.transform = 'translateX(-${mode === 'defects' ? '0' : '220'}px)'
  }}>Revealed on focus</button></div>
  <div className="covered-control"><button type="button">Covered action</button>
  <span aria-hidden="true" className="pointer-cover"
    style={{ pointerEvents: '${mode === 'defects' ? 'auto' : 'none'}' }} />
  </div></> }
`,
)
writePage(
  'motion',
  `"use client"
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
export default function Page() {
  const [opened, setOpened] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (opened) dialog.current?.showModal() }, [opened])
  return <section onFocusCapture={(event) => {
    const popup = event.target.closest('dialog')
    if (popup && getComputedStyle(popup).opacity === '0' &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches && trigger.current) {
      trigger.current.style.opacity = '${mode === 'defects' ? '0' : '1'}'
    }
  }}><h1>Normal motion dialog</h1><div aria-hidden="true" className="moving-background" />
  <button {...{ ref: trigger }} type="button" aria-haspopup="dialog" onClick={() => setOpened(true)}>
Read details</button>
  {opened && createPortal(<dialog {...{ ref: dialog }} className="motion-dialog" aria-labelledby="dialog-title"
  onKeyDown={(event) => {
    if (event.key === 'Tab') { event.preventDefault(); event.currentTarget.querySelector('button')?.focus() }
  }} onClose={() => {
    setOpened(false); trigger.current?.focus()
  }}><h2 id="dialog-title">Details</h2><button type="button" onClick={() => dialog.current?.close()}>Close</button>
  </dialog>, document.body)}</section>
}`,
)
const specifications: string = path.join(directory, 'tests/e2e')
mkdirSync(specifications, { recursive: true })
writeFileSync(
  path.join(specifications, 'project-scan.e2e.spec.ts'),
  `
import { test, expect } from '@playwright/test'
import { expectSweptPage } from 'ploaness/a11y'
test('scans the account', async ({ page }) => {
  await page.goto(${mode === 'valid' ? "['/pri', 'vate'].join('')" : "'/private'"})
  await expect(page.getByRole('heading', { name: 'Unlinked account' })).toBeVisible()
  if (process.env['PLOANESS_FIXTURE_SCAN'] !== 'no') await expectSweptPage(page)
})
`,
)

const styles: string = path.join(app, 'globals.css')
writeFileSync(
  styles,
  readFileSync(styles, 'utf8') +
    `
.moving-background {
  position: fixed; width: 20px; height: 20px; pointer-events: none;
  animation: drift 30s linear infinite;
}
@keyframes drift { from { transform: translateX(0); } to { transform: translateX(100px); } }
.motion-dialog { animation: appear 0.15s ease both; }
@keyframes appear { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .motion-dialog, .moving-background { animation: none; }
}
.covered-control { position: relative; display: inline-block; }
.pointer-cover { position: absolute; inset: 0; }
@media (prefers-reduced-motion: no-preference) {
  .moving-control { animation: drift 2s linear infinite alternate; }
  .clipped-frame { position: relative; overflow: clip; width: 220px; height: 100px; }
  .sliding-control { position: absolute; left: 220px; top: 20px; }
}
`,
)
