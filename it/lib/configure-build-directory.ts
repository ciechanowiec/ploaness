// Exercise the production output choice using the installed Next configuration loader.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ARGUMENT_OFFSET: number = 2
const [directory, mode]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (directory === undefined || !['ordinary', 'standalone'].includes(mode ?? '')) {
  throw new Error('Expected the fixture directory and ordinary or standalone output')
}
const config: string = path.join(directory, 'next.config.ts')
const output: string = mode === 'standalone' ? "output: 'standalone', " : ''
const distribution: string = "distDir: process.env['NODE_ENV'] === 'production' ? '.production' : '.development', "
writeFileSync(
  config,
  readFileSync(config, 'utf8').replace('export default { ', (): string => `export default { ${output}${distribution}`),
)
appendFileSync(path.join(directory, '.gitignore'), '\n.production/\n.development/\n')
