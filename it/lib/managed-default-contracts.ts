// Verify exact bytes and ownership through the packed init, sync and assets commands.
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { asRecord, asText, isArray } from '@ploaness/governance'

interface ManagedDefault {
  readonly path: string
  readonly expected: string
  readonly previous: string
}

const FIXTURES_ARGUMENT: number = 2
const EXECUTABLE_ARGUMENT: number = 3
const fixturesPath: string | undefined = process.argv[FIXTURES_ARGUMENT]
const executable: string | undefined = process.argv[EXECUTABLE_ARGUMENT]
if (fixturesPath === undefined || executable === undefined) {
  throw new Error('Expected managed defaults and the packed ploaness executable')
}
const parsed: unknown = JSON.parse(readFileSync(fixturesPath, 'utf8'))
if (!isArray(parsed)) {
  throw new Error('Expected managed default fixtures')
}
const fixtures: readonly ManagedDefault[] = parsed.map((value: unknown): ManagedDefault => {
  const record: Record<string, unknown> = asRecord(value)
  return {
    path: asText(record['path']),
    expected: asText(record['expected']),
    previous: asText(record['previous']),
  }
})

const command = (commandArguments: readonly string[], status: number, finding: string): string => {
  const result: SpawnSyncReturns<string> = spawnSync(executable, commandArguments, { encoding: 'utf8' })
  const output: string = `${result.stdout}${result.stderr}`
  if (result.status !== status || !output.includes(finding)) {
    throw new Error(`Expected exit ${String(status)} and ${finding}\n${output}`)
  }
  return output
}

const requireBytes = (fixture: ManagedDefault): void => {
  if (!readFileSync(fixture.path).equals(Buffer.from(fixture.expected, 'utf8'))) {
    throw new Error(`${fixture.path} differs from the required UTF-8 bytes`)
  }
}

for (const fixture of fixtures) {
  rmSync(fixture.path)
}
command(['init'], 0, '.editorconfig')
for (const fixture of fixtures) {
  requireBytes(fixture)
  writeFileSync(fixture.path, fixture.previous)
}
const upgrades: string = command(['sync'], 0, '.editorconfig')
if (!upgrades.includes('.gitattributes')) {
  throw new Error('Synchronization did not report upgrading both pinned files')
}
for (const fixture of fixtures) {
  requireBytes(fixture)
}
const before: readonly bigint[] = fixtures.map(
  (fixture: ManagedDefault): bigint => statSync(fixture.path, { bigint: true }).mtimeNs,
)
command(['sync'], 0, 'every managed path already matches')
for (const [index, fixture] of fixtures.entries()) {
  requireBytes(fixture)
  if (statSync(fixture.path, { bigint: true }).mtimeNs !== before[index]) {
    throw new Error(`A second synchronization rewrote ${fixture.path}`)
  }
}
command(['gate', 'assets'], 0, '[PASS] assets')
for (const fixture of fixtures) {
  writeFileSync(fixture.path, `${fixture.expected}\n`)
  command(['gate', 'assets'], 1, `${fixture.path}: managed file drifted`)
  command(['sync'], 0, fixture.path)
  requireBytes(fixture)
}
command(['gate', 'assets'], 0, '[PASS] assets')
console.info('managed defaults install, upgrade, remain unchanged and reject drift')
