// Rot gates: a reference that no longer resolves. Documentation drifts away from the repository, a tool
// config keeps carving out a file that was renamed, and a skill manifest loses the frontmatter an agent
// needs to find it. None of these break a build on their own, which is exactly why they accumulate.
import { existsSync, globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  type ConfigReferenceViolation,
  type DocumentViolation,
  extractLiteralSourcePaths,
  findDocumentReferenceViolations,
  findMissingConfigReferences,
  findSkillManifestViolations,
  requiredBiomeFiles,
  type SkillViolation,
} from '@ploaness/governance'
import { type Context, shippedDirectory } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

const DOC_FILES: readonly string[] = ['AGENTS.md', 'CLAUDE.md']

const asRecord = (raw: unknown): Record<string, unknown> =>
  typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}

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
  const scriptNames: ReadonlySet<string> = new Set(
    Object.keys(asRecord(asRecord(context.packageJson)['scripts'])),
  )
  const fileExists = (relativePath: string): boolean =>
    existsSync(path.join(context.root, relativePath))
  const findings: string[] = []
  let scanned: number = 0
  for (const documentFile of DOC_FILES) {
    const full: string = path.join(context.root, documentFile)
    if (!existsSync(full)) {
      continue
    }
    scanned += 1
    const violations: readonly DocumentViolation[] = findDocumentReferenceViolations({
      markdown: readFileSync(full, 'utf8'),
      scriptNames,
      fileExists,
      reservedWords,
    })
    for (const violation of violations) {
      findings.push(
        `${documentFile}: ${violation.reference} (${violation.kind}) ${violation.reason}`,
      )
    }
  }
  return findings.length > 0
    ? failed(`${findings.length} stale reference(s) in the agent docs`, findings)
    : passed(`references in ${scanned} agent doc(s) resolve`)
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
  new Set(
    extractLiteralSourcePaths(JSON.stringify(requiredBiomeFiles(context.settings.sourceRoots))),
  )

/** A concrete source file carved out of a tool config must still exist on disk. */
export const configReferences = (context: Context): GateResult => {
  const fileExists = (relativePath: string): boolean =>
    existsSync(path.join(context.root, relativePath))
  const mandated: ReadonlySet<string> = mandatedReferences(context)
  const findings: string[] = []
  for (const configPath of configTargets(context)) {
    const paths: readonly string[] = extractLiteralSourcePaths(readFileSync(configPath, 'utf8'))
    const violations: readonly ConfigReferenceViolation[] = findMissingConfigReferences(
      paths,
      fileExists,
    )
    for (const violation of violations) {
      if (mandated.has(violation.path)) {
        continue
      }
      findings.push(`${path.basename(configPath)}: ${violation.path} (${violation.reason})`)
    }
  }
  return findings.length > 0
    ? failed(`${findings.length} dangling config reference(s)`, findings)
    : passed('every source file carved out of a tool config exists')
}

/** The frontmatter an agent uses to discover and invoke a skill must be well formed. */
export const skills = (context: Context): GateResult => {
  const found: readonly string[] = globSync('.claude/skills/**/SKILL.md', { cwd: context.root })
  const findings: string[] = []
  for (const relativePath of [...found].sort((a: string, b: string): number =>
    a.localeCompare(b),
  )) {
    const violations: readonly SkillViolation[] = findSkillManifestViolations({
      content: readFileSync(path.join(context.root, relativePath), 'utf8'),
      directoryName: path.basename(path.dirname(relativePath)),
    })
    for (const violation of violations) {
      findings.push(`${relativePath} [${violation.rule}] ${violation.reason}`)
    }
  }
  return findings.length > 0
    ? failed(`${findings.length} skill frontmatter violation(s)`, findings)
    : passed(`${found.length} skill manifest(s) are well formed`)
}
