// Production output can depend on wrapper-provided values or Next's production environment files.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { asRecord } from '@ploaness/governance'

const ARGUMENT_OFFSET: number = 2
const [directory, mode]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (directory === undefined || !['wrapper', 'files'].includes(mode ?? '')) {
  throw new Error('Expected the fixture directory and wrapper or files environment mode')
}
const JSON_INDENT: number = 2
const config: string = path.join(directory, 'next.config.ts')
const original: string = readFileSync(config, 'utf8')
const requireWrapper: string =
  mode === 'wrapper'
    ? "if (process.env['REQUIRED_WRAPPER'] !== 'present') { throw new Error('required build wrapper is missing') }\n"
    : ''
writeFileSync(
  config,
  requireWrapper + original.replace('export default { ', "export default { distDir: process.env['BUILD_DIRECTORY'], "),
)
appendFileSync(path.join(directory, '.gitignore'), '\n.production/\n.generic/\n')
if (mode === 'wrapper') {
  const manifestPath: string = path.join(directory, 'package.json')
  const manifest: Record<string, unknown> = asRecord(JSON.parse(readFileSync(manifestPath, 'utf8')))
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        ...manifest,
        ploaness: {
          ...asRecord(manifest['ploaness']),
          testWrapper: ['env', 'BUILD_DIRECTORY=.production', 'REQUIRED_WRAPPER=present'],
        },
      },
      null,
      JSON_INDENT,
    )}\n`,
  )
} else {
  writeFileSync(path.join(directory, '.env'), 'BUILD_DIRECTORY=.generic\n')
  writeFileSync(path.join(directory, '.env.production.local'), 'BUILD_DIRECTORY=.production\n')
}
