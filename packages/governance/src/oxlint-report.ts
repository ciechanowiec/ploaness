import { asRecord, asText, isArray, isRecord } from './json-shapes.js'

const reportOf = (output: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(output)
    return isRecord(parsed) && !isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

const diagnostic = (value: unknown): string => {
  const record: Record<string, unknown> = asRecord(value)
  const file: string = asText(record['filename'])
  const code: string = asText(record['code'])
  const message: string = asText(record['message'])
  return `${file} ${code}: ${message.length > 0 ? message : 'malformed Oxlint diagnostic'}`.trim()
}

/**
 * Validate the native verdict and its coverage rather than trusting a zero exit status alone.
 * @param output the tool's unmodified JSON stdout.
 * @param files how many explicit files the invocation supplied.
 * @param rules how many rules the harness configured.
 * @returns findings, including malformed or incomplete reports.
 */
export const oxlintReportProblems = (
  output: string,
  files: number,
  rules: number,
): readonly string[] => {
  const report: Record<string, unknown> | undefined = reportOf(output)
  if (report === undefined || !isArray(report['diagnostics'])) {
    return ['Oxlint did not return a valid diagnostic report']
  }
  return [
    ...(report['number_of_files'] === files
      ? []
      : [`Oxlint did not analyze the expected ${String(files)} JSX file(s)`]),
    ...(report['number_of_rules'] === rules
      ? []
      : [`Oxlint did not enable the expected ${String(rules)} accessibility rule(s)`]),
    ...report['diagnostics'].map((value: unknown): string => diagnostic(value)),
  ]
}

/**
 * The fixed invocation: no project config discovery, ignore files, fixers, or extra arguments.
 * @param config absolute path to the configuration generated from the harness registry.
 * @param files explicit member-relative files.
 * @returns arguments passed without shell interpolation.
 */
export const oxlintArguments = (config: string, files: readonly string[]): readonly string[] => [
  '--config',
  config,
  '--disable-nested-config',
  '--no-ignore',
  '--deny-warnings',
  '--report-unused-disable-directives-severity',
  'error',
  '--format',
  'json',
  '--',
  ...files,
]
