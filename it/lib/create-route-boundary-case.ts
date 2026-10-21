// A public page sharing an API prefix remains part of the managed browser sweep.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const DIRECTORY_ARGUMENT: number = 2
const directory: string | undefined = process.argv[DIRECTORY_ARGUMENT]
if (directory === undefined) {
  throw new Error('Expected the browser fixture directory')
}
const app: string = path.join(directory, 'src/app')
const home: string = path.join(app, 'page.tsx')
writeFileSync(
  home,
  readFileSync(home, 'utf8').replace(
    '</main>',
    '<a href="/apiary">Public apiary</a><a href="/admin">Administration</a></main>',
  ),
)
for (const route of ['apiary', 'admin']) {
  mkdirSync(path.join(app, route), { recursive: true })
  writeFileSync(
    path.join(app, route, 'page.tsx'),
    [
      'export default function Page(): React.JSX.Element { return <main><h1>Route boundary</h1>',
      '<button type="button"><span aria-hidden="true">Open</span></button></main> }',
      '',
    ].join('\n'),
  )
}
