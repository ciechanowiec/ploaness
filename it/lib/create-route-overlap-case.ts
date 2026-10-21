// A linked static page must not stand in for its unlinked dynamic sibling.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const DIRECTORY_ARGUMENT: number = 2
const directory: string | undefined = process.argv[DIRECTORY_ARGUMENT]
if (directory === undefined) {
  throw new Error('Expected the browser fixture directory')
}
const app: string = path.join(directory, 'src/app')
const home: string = path.join(app, 'page.tsx')
writeFileSync(home, readFileSync(home, 'utf8').replace('</main>', '<a href="/posts/new">Create a post</a></main>'))
for (const route of ['posts/new', 'posts/[slug]']) {
  mkdirSync(path.join(app, route), { recursive: true })
  writeFileSync(
    path.join(app, route, 'page.tsx'),
    'export default function Page(): React.JSX.Element { return <main><h1>Posts</h1></main> }\n',
  )
}
