// Preserve the launch environment while making the real wrapper boundary observable.
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { VERIFICATION_ENVIRONMENT_VARIABLE } from '@ploaness/governance'

const ARGUMENT_OFFSET: number = 2
const [executable, ...commandArguments]: readonly string[] = process.argv.slice(ARGUMENT_OFFSET)
if (executable === undefined) {
  throw new Error('Expected the wrapped test runner command')
}
writeFileSync('.wrapper-marker', process.env[VERIFICATION_ENVIRONMENT_VARIABLE] ?? 'absent')
const result: SpawnSyncReturns<Buffer> = spawnSync(executable, commandArguments, {
  stdio: 'inherit',
})
if (result.error !== undefined) {
  throw result.error
}
process.exitCode = result.status ?? 1
