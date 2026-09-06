import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  asRecord,
  asText,
  isEslintOwnedSuppression,
  isOxlintConfig,
  type OxlintGroup,
  type OxlintLegacySite,
  oxlintArguments,
  oxlintConfig,
  oxlintGroups,
  oxlintReportProblems,
  oxlintRuleNames,
  oxlintSourceFiles,
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
  oxlintSourceFiles(inventory, member.settings.generatedArtefacts, member.siblingPaths).filter(
    (file: string): boolean => {
      const absolute: string = path.join(member.root, file)
      return existsSync(absolute) && statSync(absolute).isFile()
    },
  )

const suppressionProblems = (member: Member, group: OxlintGroup): readonly string[] =>
  group.files.flatMap((file: string): readonly string[] => {
    const text: string = readFileSync(path.join(member.root, file), 'utf8')
    const problems: readonly string[] = oxlintSuppressionProblems(
      sourceComments(text, file),
      oxlintRuleNames(group.rules),
    )
    return problems.map((problem: string): string => `${file}: ${problem}`)
  })

const legacySitesIn = (member: Member, files: readonly string[]): readonly OxlintLegacySite[] =>
  files.flatMap((file: string): readonly OxlintLegacySite[] => {
    const text: string = readFileSync(path.join(member.root, file), 'utf8')
    return sourceComments(text, file)
      .filter(isEslintOwnedSuppression)
      .map((comment: SourceComment): OxlintLegacySite => ({ file, line: comment.line }))
  })

const nativeVerdict = (
  result: RunResult,
  group: OxlintGroup,
  legacy: readonly OxlintLegacySite[],
): GateResult => {
  const findings: readonly string[] = oxlintReportProblems(
    result.stdout,
    group.files.length,
    group.rules.length,
    { exitCode: result.code, output: result.output, legacy },
  )
  return withOutput(
    findings.length === 0
      ? passed(
          `${String(group.files.length)} source file(s) pass ${String(group.rules.length)} native rules`,
        )
      : failed('Oxlint did not establish conformance', [
          ...findings,
          ...(result.code === 0 ? [] : [result.output]),
        ]),
    result.output,
  )
}

const analyze = (member: Member, group: OxlintGroup): GateResult => {
  const directory: string = mkdtempSync(path.join(tmpdir(), 'ploaness-oxlint-'))
  try {
    const config: string = path.join(directory, 'oxlint.json')
    writeFileSync(config, `${JSON.stringify(oxlintConfig(group.rules), null, JSON_INDENT)}\n`)
    const legacy: readonly OxlintLegacySite[] = legacySitesIn(member, group.files)
    return nativeVerdict(
      runNode(resolveTool('oxlint'), [...oxlintArguments(config, group.files)], {
        cwd: member.root,
      }),
      group,
      legacy,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/** Run disjoint groups sequentially, preserving each invocation's measured coverage. */
const analyzeGroups = (member: Member, groups: readonly OxlintGroup[]): GateResult => {
  const [first, ...rest]: readonly OxlintGroup[] = groups
  if (first === undefined) {
    return passed('no eligible source remains to analyze')
  }
  const result: GateResult = analyze(member, first)
  if (!result.ok || rest.length === 0) {
    return result
  }
  const remaining: GateResult = analyzeGroups(member, rest)
  return withOutput(
    { ...remaining, summary: `${result.summary}; ${remaining.summary}` },
    [result.output, remaining.output].filter(Boolean).join('\n'),
  )
}

/** Native core checks for every member, with accessibility only in the existing application scope. */
export const oxlint = (member: Member): GateResult => {
  const inventory: readonly string[] = workingTreeFiles(member.root)
  const groups: readonly OxlintGroup[] = oxlintGroups(
    eligibleFiles(member, inventory),
    hasOwnRuntime(member),
  )
  const problems: readonly string[] = [
    ...versionProblems(),
    ...inventory
      .filter(isOxlintConfig)
      .map((file: string): string => `${file}: Oxlint configuration is owned by ploaness`),
    ...groups.flatMap((group: OxlintGroup): readonly string[] =>
      suppressionProblems(member, group),
    ),
  ]
  if (problems.length > 0) {
    return failed('Oxlint wiring or suppression policy is violated', problems)
  }
  return analyzeGroups(member, groups)
}
