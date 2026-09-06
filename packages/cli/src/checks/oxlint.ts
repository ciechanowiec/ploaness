import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  asRecord,
  asText,
  isEslintOwnedSuppression,
  isOxlintConfig,
  JSX_ACCESSIBILITY_RULES,
  jsxAccessibilityFiles,
  type OxlintLegacySite,
  oxlintAccessibilityConfig,
  oxlintArguments,
  oxlintReportProblems,
  oxlintSuppressionProblems,
  type SourceComment,
} from '@ploaness/governance'
import {
  cliDirectory,
  hasOwnRuntime,
  type Member,
  readJson,
  resolveTool,
  shippedDirectory,
  workingTreeFiles,
} from '../context.js'
import { failed, type GateResult, passed, type RunResult, runNode, withOutput } from '../exec.js'
import { sourceComments } from '../source-comments.js'

const JSON_INDENT: number = 2

const manifestIn = (directory: string): Record<string, unknown> =>
  asRecord(readJson(path.join(directory, 'package.json')))

const versionProblems = (): readonly string[] => {
  const cli: Record<string, unknown> = manifestIn(cliDirectory())
  const expected: string = asText(asRecord(cli['dependencies'])['oxlint'])
  const manifest: Record<string, unknown> = manifestIn(shippedDirectory('oxlint'))
  return expected.length > 0 && manifest['version'] === expected
    ? []
    : [`Oxlint must resolve to the harness-owned version ${expected}`]
}

const eligibleFiles = (member: Member, inventory: readonly string[]): readonly string[] =>
  jsxAccessibilityFiles(inventory, member.settings.generatedArtefacts, member.siblingPaths).filter(
    (file: string): boolean => {
      const absolute: string = path.join(member.root, file)
      return existsSync(absolute) && statSync(absolute).isFile()
    },
  )

const suppressionProblems = (member: Member, files: readonly string[]): readonly string[] =>
  files.flatMap((file: string): readonly string[] => {
    const text: string = readFileSync(path.join(member.root, file), 'utf8')
    const problems: readonly string[] = oxlintSuppressionProblems(sourceComments(text))
    return problems.map((problem: string): string => `${file}: ${problem}`)
  })

const legacySitesIn = (member: Member, files: readonly string[]): readonly OxlintLegacySite[] =>
  files.flatMap((file: string): readonly OxlintLegacySite[] => {
    const text: string = readFileSync(path.join(member.root, file), 'utf8')
    return sourceComments(text)
      .filter(isEslintOwnedSuppression)
      .map((comment: SourceComment): OxlintLegacySite => ({ file, line: comment.line }))
  })

const nativeVerdict = (
  result: RunResult,
  files: number,
  legacy: readonly OxlintLegacySite[],
): GateResult => {
  const findings: readonly string[] = oxlintReportProblems(
    result.stdout,
    files,
    JSX_ACCESSIBILITY_RULES.length,
    { exitCode: result.code, legacy },
  )
  return withOutput(
    findings.length === 0
      ? passed(
          `${String(files)} JSX file(s) pass ${String(JSX_ACCESSIBILITY_RULES.length)} accessibility rules`,
        )
      : failed('Oxlint did not establish JSX accessibility conformance', [
          ...findings,
          ...(result.code === 0 ? [] : [result.output]),
        ]),
    result.output,
  )
}

const analyze = (member: Member, files: readonly string[]): GateResult => {
  const directory: string = mkdtempSync(path.join(tmpdir(), 'ploaness-oxlint-'))
  try {
    const config: string = path.join(directory, 'oxlint.json')
    writeFileSync(config, `${JSON.stringify(oxlintAccessibilityConfig(), null, JSON_INDENT)}\n`)
    const legacy: readonly OxlintLegacySite[] = legacySitesIn(member, files)
    return nativeVerdict(
      runNode(resolveTool('oxlint'), [...oxlintArguments(config, files)], { cwd: member.root }),
      files.length,
      legacy,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/** Native application JSX checks; libraries keep the Biome policy their existing config supplies. */
export const oxlint = (member: Member): GateResult => {
  if (!hasOwnRuntime(member)) {
    return passed('this library retains its Biome accessibility policy')
  }
  const inventory: readonly string[] = workingTreeFiles(member.root)
  const files: readonly string[] = eligibleFiles(member, inventory)
  const problems: readonly string[] = [
    ...versionProblems(),
    ...inventory
      .filter(isOxlintConfig)
      .map((file: string): string => `${file}: Oxlint configuration is owned by ploaness`),
    ...suppressionProblems(member, files),
  ]
  if (problems.length > 0) {
    return failed('Oxlint wiring or suppression policy is violated', problems)
  }
  return files.length === 0
    ? passed('this application has no eligible JSX source to analyze')
    : analyze(member, files)
}
