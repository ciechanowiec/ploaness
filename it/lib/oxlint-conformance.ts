// Exercise source selection, semantic boundaries and suppressions through the real packed gate.
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { asRecord, asText, isArray } from '@ploaness/governance'

interface NativeCase {
  readonly name: string
  readonly file: string
  readonly code: string
  readonly expected: string
}

const INPUT_ARGUMENT: number = 2
const EXECUTABLE_ARGUMENT: number = 3
const MAX_OUTPUT_BYTES: number = 8_388_608

const fixtureOf = (value: unknown): NativeCase => {
  const record: Record<string, unknown> = asRecord(value)
  const fixture: NativeCase = {
    name: asText(record['name']),
    file: asText(record['file']),
    code: asText(record['code']),
    expected: asText(record['expected']),
  }
  if (fixture.name.length === 0 || fixture.file.length === 0 || fixture.code.length === 0) {
    throw new Error('Incomplete native conformance fixture')
  }
  return fixture
}

const checkCase = (fixture: NativeCase, executable: string): void => {
  const previous: string | undefined = existsSync(fixture.file)
    ? readFileSync(fixture.file, 'utf8')
    : undefined
  mkdirSync(path.dirname(fixture.file), { recursive: true })
  writeFileSync(fixture.file, `${fixture.code}\n`)
  try {
    const result: SpawnSyncReturns<string> = spawnSync(executable, ['gate', 'oxlint'], {
      encoding: 'utf8',
      maxBuffer: MAX_OUTPUT_BYTES,
    })
    const output: string = `${result.stdout}${result.stderr}`
    const expectedStatus: number = fixture.expected.length === 0 ? 0 : 1
    const marker: string = expectedStatus === 0 ? '[PASS] oxlint' : '[FAIL] oxlint'
    if (
      result.status !== expectedStatus ||
      !output.includes(marker) ||
      !output.includes(fixture.expected)
    ) {
      throw new Error(`${fixture.name}: expected ${marker} ${fixture.expected}\n${output}`)
    }
  } finally {
    if (previous === undefined) {
      rmSync(fixture.file)
    } else {
      writeFileSync(fixture.file, previous)
    }
  }
}

const source: string | undefined = process.argv[INPUT_ARGUMENT]
const executable: string | undefined = process.argv[EXECUTABLE_ARGUMENT]
if (source === undefined || executable === undefined) {
  throw new Error('Expected the native fixture file and the packed ploaness executable')
}
const CASE_COUNT: number = 30
const parsed: unknown = JSON.parse(readFileSync(source, 'utf8'))
if (!isArray(parsed) || parsed.length !== CASE_COUNT) {
  throw new Error(`Expected ${String(CASE_COUNT)} native conformance cases`)
}
const fixtures: readonly NativeCase[] = parsed.map((value: unknown): NativeCase => fixtureOf(value))
if (new Set(fixtures.map((fixture: NativeCase): string => fixture.name)).size !== CASE_COUNT) {
  throw new Error('Native conformance case names must be unique')
}
for (const fixture of fixtures) {
  checkCase(fixture, executable)
}
console.info(`${String(CASE_COUNT)} native source and suppression contracts passed`)
