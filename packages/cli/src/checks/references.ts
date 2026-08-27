// Rot gates: a reference that no longer resolves. Documentation drifts away from the repository, a tool
// config keeps carving out a file that was renamed, and a skill manifest loses the frontmatter an agent
// needs to find it. None of these break a build on their own, which is exactly why they accumulate.
import { existsSync, globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  asRecord,
  COVERAGE_INCLUDE,
  type ConfigReferenceViolation,
  type DeclaredExclusion,
  type DocumentViolation,
  extractLiteralSourcePaths,
  findDocumentReferenceViolations,
  findMissingConfigReferences,
  findSkillManifestViolations,
  findUnreachedExclusions,
  matchesGlob,
  requiredBiomeFiles,
  type SkillViolation,
} from '@ploaness/governance'
import { type Context, shippedDirectory, trackedFiles } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

const DOC_FILES: readonly string[] = ['AGENTS.md', 'CLAUDE.md']

const declaredScripts = (context: Context): Record<string, unknown> =>
  asRecord(asRecord(context.packageJson)['scripts'])

const biomeFilesJson = (context: Context): string =>
  JSON.stringify(requiredBiomeFiles(context.settings.sourceRoots))

/**
 * Every npm script and full-path file the agent docs name must still exist.
 * @param context the resolved project environment.
 * @param reservedWords words that look like a script but name something else, such as a gate. The
 *   registry supplies them, so this module does not have to import it back and create a cycle.
 */
export const documentation = (
  context: Context,
  reservedWords: ReadonlySet<string> = new Set<string>(),
): GateResult => {
  const scriptNames: ReadonlySet<string> = new Set(Object.keys(declaredScripts(context)))
  const isExistingFile = (relativePath: string): boolean =>
    existsSync(path.join(context.root, relativePath))
  const present: readonly string[] = DOC_FILES.filter((documentFile: string): boolean =>
    existsSync(path.join(context.root, documentFile)),
  )
  const findings: readonly string[] = present.flatMap((documentFile: string): readonly string[] =>
    findDocumentReferenceViolations({
      markdown: readFileSync(path.join(context.root, documentFile), 'utf8'),
      scriptNames,
      isExistingFile,
      reservedWords,
    }).map(
      (violation: DocumentViolation): string =>
        `${documentFile}: ${violation.reference} (${violation.kind}) ${violation.reason}`,
    ),
  )
  const scanned: number = present.length
  return findings.length > 0
    ? failed(`${String(findings.length)} stale reference(s) in the agent docs`, findings)
    : passed(`references in ${String(scanned)} agent doc(s) resolve`)
}

// Both the ploaness-owned configs and any the project still holds are scanned. A carve-out in the
// harness config names a consumer path, so it rots when the consumer renames that file.
const configTargets = (context: Context): readonly string[] => {
  const owned: string = shippedDirectory('@ploaness/config')
  return [
    path.join(owned, 'biome.json'),
    path.join(owned, 'dependency-cruiser.json'),
    path.join(owned, 'knip.json'),
    path.join(context.root, 'biome.json'),
    path.join(context.root, 'vitest.config.mts'),
  ].filter((file: string): boolean => existsSync(file))
}

// A carve-out ploaness itself dictates is not the project's to repair. The wiring gate requires the
// biome file-selection block byte for byte, so a path inside it cannot be stale in the sense this gate
// means: the project is forbidden to remove it. Reporting it anyway would fail a project for obeying
// another gate, which is what a Payload project that has not generated its types yet would hit on its
// first run. Whether those generated artefacts are correct is the payload-generated gate's question.
const mandatedReferences = (context: Context): ReadonlySet<string> =>
  new Set(extractLiteralSourcePaths(biomeFilesJson(context)))

// A declared exclusion is judged against the paths the gate it narrows would otherwise have read: a
// coverage exclusion against what the coverage report measures, a typography or JavaScript exclusion
// against the tracked tree the conventions gate walks. Judging either against the other's set would
// report a finding about the wrong thing.
const measuredByCoverage = (tracked: readonly string[]): readonly string[] =>
  tracked.filter((file: string): boolean =>
    COVERAGE_INCLUDE.some((pattern: string): boolean => matchesGlob(pattern, file)),
  )

// Which file set an exclusion has to reach is decided by the SETTING it came from, not by how its
// pattern is written. Partitioning on the pattern's kind was right while `coverageExclude` was the only
// glob-shaped setting; it stopped being right the moment two more arrived, and it reported a carve-out
// naming a real file as reaching nothing - because it was asking whether a generated artefact appears
// in the coverage report, which is precisely where it does not.
const COVERAGE_SETTING: string = 'coverageExclude'

const deadExclusions = (context: Context): readonly string[] => {
  const tracked: readonly string[] = trackedFiles(context.root)
  const declared: readonly DeclaredExclusion[] = context.settings.declaredExclusions
  const isCoverage = (entry: DeclaredExclusion): boolean => entry.setting === COVERAGE_SETTING
  return [
    ...findUnreachedExclusions(
      declared.filter((entry: DeclaredExclusion): boolean => isCoverage(entry)),
      measuredByCoverage(tracked),
    ),
    ...findUnreachedExclusions(
      declared.filter((entry: DeclaredExclusion): boolean => !isCoverage(entry)),
      tracked,
    ),
  ]
}

/**
 * A concrete source file carved out of a tool config must still exist on disk, and a declared exclusion
 * must exclude something. Both are the same defect at different scales: a carve-out that reaches
 * nothing leaves the report reading exactly as it would have read without it.
 */
export const configReferences = (context: Context): GateResult => {
  const isExistingFile = (relativePath: string): boolean =>
    existsSync(path.join(context.root, relativePath))
  const mandated: ReadonlySet<string> = mandatedReferences(context)
  const dangling: readonly string[] = configTargets(context).flatMap(
    (configPath: string): readonly string[] =>
      findMissingConfigReferences(
        extractLiteralSourcePaths(readFileSync(configPath, 'utf8')),
        isExistingFile,
      )
        .filter((violation: ConfigReferenceViolation): boolean => !mandated.has(violation.path))
        .map(
          (violation: ConfigReferenceViolation): string =>
            `${path.basename(configPath)}: ${violation.path} (${violation.reason})`,
        ),
  )
  const findings: readonly string[] = [...dangling, ...deadExclusions(context)]
  return findings.length > 0
    ? failed(`${String(findings.length)} carve-out(s) that reach nothing`, findings)
    : passed('every carve-out of a tool config or setting reaches a file that exists')
}

/** The frontmatter an agent uses to discover and invoke a skill must be well formed. */
export const skills = (context: Context): GateResult => {
  const found: readonly string[] = globSync('.claude/skills/**/SKILL.md', { cwd: context.root })
  const findings: readonly string[] = [...found]
    .sort((left: string, right: string): number => left.localeCompare(right))
    .flatMap((relativePath: string): readonly string[] =>
      findSkillManifestViolations({
        content: readFileSync(path.join(context.root, relativePath), 'utf8'),
        directoryName: path.basename(path.dirname(relativePath)),
      }).map(
        (violation: SkillViolation): string =>
          `${relativePath} [${violation.rule}] ${violation.reason}`,
      ),
    )
  return findings.length > 0
    ? failed(`${String(findings.length)} skill frontmatter violation(s)`, findings)
    : passed(`${String(found.length)} skill manifest(s) are well formed`)
}
