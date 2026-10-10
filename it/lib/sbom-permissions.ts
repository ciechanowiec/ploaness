// Exercise the installed command with private inputs and a restrictive creation mask.
import { chmodSync, readFileSync, statSync } from 'node:fs'
import { userInfo } from 'node:os'
import { invoke, requireResult } from './browser-server-support.js'

const EXECUTABLE_ARGUMENT: number = 2
const executable: string | undefined = process.argv[EXECUTABLE_ARGUMENT]
if (executable === undefined) {
  throw new Error('Expected the packed ploaness executable')
}
const PRIVATE_FILE_MODE: number = 0o600
const PRIVATE_DIRECTORY_MODE: number = 0o700
const PRIVATE_MASK: number = 0o077
const PERMISSION_MODULUS: number = 0o1000
const DIRECTORY: string = 'dist/private-sbom'
const inputs: readonly { readonly file: string; readonly mode: number; readonly content: string }[] = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'packages/one/package.json',
  'packages/two/package.json',
].map((file: string) => ({ file, mode: statSync(file).mode, content: readFileSync(file, 'utf8') }))
const previousMask: number = process.umask(PRIVATE_MASK)
try {
  for (const input of inputs) {
    chmodSync(input.file, PRIVATE_FILE_MODE)
  }
  requireResult(
    await invoke(executable, ['sbom', '--artifact', 'dist/release.tgz', '--output', DIRECTORY]),
    0,
    'SBOM and release metadata written',
  )
  const { uid, gid } = userInfo()
  for (const [file, mode] of [
    [DIRECTORY, PRIVATE_DIRECTORY_MODE],
    [`${DIRECTORY}/bom.cdx.json`, PRIVATE_FILE_MODE],
    [`${DIRECTORY}/release.json`, PRIVATE_FILE_MODE],
  ] as const) {
    const actual: ReturnType<typeof statSync> = statSync(file)
    if (actual.uid !== uid || actual.gid !== gid || actual.mode % PERMISSION_MODULUS !== mode) {
      throw new Error(`The SBOM output is not private and owned by the invoking user: ${file}`)
    }
  }
  for (const input of inputs) {
    if (
      statSync(input.file).mode % PERMISSION_MODULUS !== PRIVATE_FILE_MODE ||
      readFileSync(input.file, 'utf8') !== input.content
    ) {
      throw new Error(`SBOM generation changed its input bytes or permissions: ${input.file}`)
    }
  }
} finally {
  process.umask(previousMask)
  for (const input of inputs) {
    chmodSync(input.file, input.mode)
  }
}
console.info('SBOM private inputs and caller-owned outputs passed')
