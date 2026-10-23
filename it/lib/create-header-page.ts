// One reachable page has a broken response baseline while the home page remains valid.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const DIRECTORY_ARGUMENT: number = 2
const directory: string | undefined = process.argv[DIRECTORY_ARGUMENT]
if (directory === undefined) {
  throw new Error('Expected the browser fixture directory')
}
const app: string = path.join(directory, 'src/app')
// Next's configured headers own this fixture's policy; the seeded proxy would replace the bad header.
rmSync(path.join(directory, 'src/proxy.ts'), { force: true })
const home: string = path.join(app, 'page.tsx')
writeFileSync(home, readFileSync(home, 'utf8').replace('</main>', '<a href="/unprotected">Another page</a></main>'))
mkdirSync(path.join(app, 'unprotected'))
writeFileSync(
  path.join(app, 'unprotected/page.tsx'),
  ['export default function Page(): React.JSX.Element { return <main><h1>Another page</h1></main> }', ''].join('\n'),
)
const config: string = path.join(directory, 'next.config.ts')
// Without the proxy the static policy is the only one, as `create-a11y-page.ts` writes it in that case.
const policy: string =
  "    { key: \"Content-Security-Policy\", value: \"default-src 'self'; script-src 'self' 'unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline'; frame-ancestors 'none'\" },\n"
const extra: string =
  `${policy}  ] }, { source: "/unprotected", ` + 'headers: [{ key: "X-Content-Type-Options", value: "invalid" }] }] } }'
writeFileSync(
  config,
  readFileSync(config, 'utf8').replace('  ] }] } }', (): string => extra),
)
