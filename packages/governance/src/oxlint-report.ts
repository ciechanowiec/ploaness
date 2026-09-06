import { asRecord, asText, isArray, isRecord } from './json-shapes.js'

/** A parser-confirmed suppression for rules owned solely by ESLint. */
export interface OxlintLegacySite {
  readonly file: string
  readonly line: number
}

/** Process status and foreign directive locations validated before native analysis. */
export interface OxlintExecution {
  readonly exitCode: number
  /** Combined process output, including stderr, startup failures, and termination signals. */
  readonly output?: string
  readonly legacy: readonly OxlintLegacySite[]
}

const SUCCESSFUL_EXECUTION: OxlintExecution = { exitCode: 0, legacy: [] }

const isEslintOwnedDiagnostic = (value: unknown, sites: readonly OxlintLegacySite[]): boolean => {
  const record: Record<string, unknown> = asRecord(value)
  const labels: unknown = record['labels']
  const label: Record<string, unknown> = asRecord(isArray(labels) ? labels[0] : undefined)
  const span: Record<string, unknown> = asRecord(label['span'])
  return (
    record['message'] === 'Unused eslint-disable directive (no problems were reported).' &&
    record['code'] === undefined &&
    record['severity'] === 'error' &&
    sites.some(
      (site: OxlintLegacySite): boolean =>
        site.file === record['filename'] && site.line === span['line'],
    )
  )
}

const exitProblems = (
  diagnostics: readonly unknown[],
  execution: OxlintExecution,
): readonly string[] => {
  const isForeignFailure: boolean =
    execution.exitCode === 1 &&
    diagnostics.some((value: unknown): boolean => isEslintOwnedDiagnostic(value, execution.legacy))
  return isForeignFailure || execution.exitCode === 0
    ? []
    : [`Oxlint exited with status ${String(execution.exitCode)} without establishing conformance`]
}

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
 * @param execution process status and parser-confirmed directives governed by ESLint.
 * @returns findings, including malformed or incomplete reports.
 */
export const oxlintReportProblems = (
  output: string,
  files: number,
  rules: number,
  execution: OxlintExecution = SUCCESSFUL_EXECUTION,
): readonly string[] => {
  const report: Record<string, unknown> | undefined = reportOf(output)
  if (report === undefined || !isArray(report['diagnostics'])) {
    return ['Oxlint did not return a valid diagnostic report']
  }
  return [
    ...exitProblems(report['diagnostics'], execution),
    ...(execution.output === undefined || execution.output.trim() === output.trim()
      ? []
      : ['Oxlint produced output outside its diagnostic report']),
    ...(report['number_of_files'] === files
      ? []
      : [`Oxlint did not analyze the expected ${String(files)} source file(s)`]),
    ...(report['number_of_rules'] === rules
      ? []
      : [`Oxlint did not enable the expected ${String(rules)} rule(s)`]),
    ...report['diagnostics']
      .filter((value: unknown): boolean => !isEslintOwnedDiagnostic(value, execution.legacy))
      .map((value: unknown): string => diagnostic(value)),
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
