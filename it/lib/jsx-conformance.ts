// Exercise the packed CLI against independent broken/correct JSX examples. No analyzer is substituted:
// the same gate, binary, configuration, and report validation a consumer receives run here.
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  asRecord,
  asText,
  isArray,
  JSX_ACCESSIBILITY_RULES,
  type JsxAccessibilityRule,
} from '@ploaness/governance'

interface JsxCase {
  readonly name: string
  readonly code: string
  readonly expected: readonly string[]
}

interface Finding {
  readonly name: string
  readonly rule: string
}

const CASE_COUNT: number = 70
const INPUT_ARGUMENT: number = 2
const EXECUTABLE_ARGUMENT: number = 3

const fixtureOf = (value: unknown): JsxCase => {
  const record: Record<string, unknown> = asRecord(value)
  const name: string = asText(record['name'])
  const code: string = asText(record['code'])
  const expected: unknown = record['expected']
  if (!/^[a-z-]+$/u.test(name) || code.length === 0 || !isArray(expected)) {
    throw new Error('Invalid JSX conformance fixture')
  }
  return { name, code, expected: expected.map((entry: unknown): string => asText(entry)) }
}

const readCases = (file: string): readonly JsxCase[] => {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!isArray(parsed) || parsed.length !== CASE_COUNT) {
    throw new Error(`Expected ${String(CASE_COUNT)} independent JSX cases`)
  }
  const fixtures: readonly JsxCase[] = parsed.map((value: unknown): JsxCase => fixtureOf(value))
  const names: ReadonlySet<string> = new Set(
    fixtures.map((fixture: JsxCase): string => fixture.name),
  )
  const expected: ReadonlySet<string> = new Set(
    fixtures.flatMap((fixture: JsxCase): readonly string[] => fixture.expected),
  )
  if (
    names.size !== CASE_COUNT ||
    JSX_ACCESSIBILITY_RULES.some(
      (rule: JsxAccessibilityRule): boolean => !expected.has(rule.oxlint),
    )
  ) {
    throw new Error('JSX contracts must have unique names and cover every configured rule')
  }
  return fixtures
}

const findingsIn = (output: string): readonly Finding[] =>
  output.split('\n').flatMap((line: string): readonly Finding[] => {
    const match: RegExpExecArray | null =
      /^src\/jsx-contract\/([^ ]+)\.tsx jsx-a11y\(([^)]+)\):/u.exec(line.trim())
    return match?.[1] !== undefined && match[2] !== undefined
      ? [{ name: match[1], rule: `jsx-a11y/${match[2]}` }]
      : []
  })

const checkCase = (fixture: JsxCase, findings: readonly Finding[]): readonly string[] => {
  const actual: readonly string[] = [
    ...new Set(
      findings
        .filter((finding: Finding): boolean => finding.name === fixture.name)
        .map((finding: Finding): string => finding.rule),
    ),
  ].toSorted((left: string, right: string): number => left.localeCompare(right))
  return JSON.stringify(actual) ===
    JSON.stringify(
      [...fixture.expected].toSorted((left: string, right: string): number =>
        left.localeCompare(right),
      ),
    )
    ? []
    : [
        `${fixture.name}: expected ${JSON.stringify(fixture.expected)}, received ${JSON.stringify(actual)}`,
      ]
}

const source: string | undefined = process.argv[INPUT_ARGUMENT]
const executable: string | undefined = process.argv[EXECUTABLE_ARGUMENT]
if (source === undefined || executable === undefined) {
  throw new Error('Expected the JSX fixture file and the packed ploaness executable')
}
const MAX_OUTPUT_BYTES: number = 8_388_608
const CASE_ROOT: string = 'src/jsx-contract'
const fixtures: readonly JsxCase[] = readCases(source)
mkdirSync(CASE_ROOT, { recursive: true })
for (const fixture of fixtures) {
  writeFileSync(
    path.join(CASE_ROOT, `${fixture.name}.tsx`),
    `export const element = (${fixture.code});\n`,
  )
}
const result: SpawnSyncReturns<string> = spawnSync(executable, ['gate', 'oxlint'], {
  encoding: 'utf8',
  maxBuffer: MAX_OUTPUT_BYTES,
})
const output: string = `${result.stdout}${result.stderr}`
if (result.status !== 1 || !output.includes('[FAIL] oxlint')) {
  throw new Error(`The packed JSX gate did not report the deliberate failures: ${output}`)
}
const findings: readonly Finding[] = findingsIn(output)
const problems: readonly string[] = fixtures.flatMap((fixture: JsxCase): readonly string[] =>
  checkCase(fixture, findings),
)
if (problems.length > 0) {
  throw new Error(problems.join('\n'))
}
console.info(`${String(fixtures.length)} JSX detection and valid-markup contracts passed`)
