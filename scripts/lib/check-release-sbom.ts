// Validate generated or recovered inventory against the commit and the actual release archive bytes.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { type ReleaseArtifact, releaseInventoryProblems, sbomProblems } from '@ploaness/governance'

const ARGUMENT_OFFSET: number = 2
const [commit, reportDirectory, archiveDirectory] = process.argv.slice(ARGUMENT_OFFSET)
if (commit === undefined || reportDirectory === undefined || archiveDirectory === undefined) {
  throw new Error('usage: check-release-sbom.ts <commit> <reports-directory> <archive-directory>')
}
const hashFile = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')
const bomFile: string = path.join(reportDirectory, 'bom.cdx.json')
const bom: unknown = JSON.parse(readFileSync(bomFile, 'utf8'))
const metadata: unknown = JSON.parse(readFileSync(path.join(reportDirectory, 'release.json'), 'utf8'))
const artifacts: readonly ReleaseArtifact[] = readdirSync(archiveDirectory)
  .filter((file: string): boolean => file.endsWith('.tgz'))
  .map((file: string): ReleaseArtifact => ({ path: file, sha256: hashFile(path.join(archiveDirectory, file)) }))
const problems: readonly string[] = [
  ...sbomProblems(bom),
  ...releaseInventoryProblems(metadata, { sourceCommit: commit, sbomSha256: hashFile(bomFile), artifacts }),
]
if (problems.length > 0) {
  throw new Error(problems.join('\n'))
}
console.info('release inventory identifies the original commit, SBOM and release archive bytes')
