// Judge the written compliance report against the fixture's own SBOM, coordinates and commit.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { asText, isRecord, readKey } from '@ploaness/governance'
import { invoke, requireResult } from './browser-server-support.js'

const EXECUTABLE_ARGUMENT: number = 2
const COMMIT_ARGUMENT: number = 3
const executable: string | undefined = process.argv[EXECUTABLE_ARGUMENT]
const commit: string | undefined = process.argv[COMMIT_ARGUMENT]
if (executable === undefined || commit === undefined) {
  throw new Error('Expected the packed ploaness executable and the fixture commit')
}
const SHORT_COMMIT: number = 12
const directory: string = 'dist/compliance'
const stem: string = `oss-compliance-report-ploaness-it-consumer-${commit.slice(0, SHORT_COMMIT)}`
const written: readonly string[] = readdirSync(directory).toSorted((left: string, right: string): number =>
  left.localeCompare(right),
)
if (JSON.stringify(written) !== JSON.stringify([`${stem}.html`, `${stem}.pdf`])) {
  throw new Error(`The report directory holds ${written.join(', ')} rather than the report pair for ${stem}`)
}
if (!readFileSync(`${directory}/${stem}.pdf`).subarray(0, '%PDF-'.length).equals(Buffer.from('%PDF-'))) {
  throw new Error('The PDF rendering is not a PDF document')
}
const html: string = readFileSync(`${directory}/${stem}.html`, 'utf8')
const embedded: unknown = JSON.parse(
  /<script type="application\/json" id="report-data">(.*?)<\/script>/su.exec(html)?.[1] ?? 'null',
)
if (!isRecord(embedded) || readKey(embedded, 'sbom') !== readFileSync('dist/sbom/bom.cdx.json', 'utf8')) {
  throw new Error('The report does not embed the SBOM the sbom gate wrote for this tree')
}
const csv: string = asText(readKey(embedded, 'csv'))
for (const row of [
  '"is-odd","3.0.1","MIT","Permissive","Production","Direct"',
  // Relation is decided by package name: a workspace manifest declares is-number, at another version.
  '"is-number","6.0.0","MIT","Permissive","Production","Direct"',
  '"is-number","7.0.0","MIT","Permissive","Development","Direct"',
]) {
  if (!csv.includes(row)) {
    throw new Error(`The package inventory lacks ${row}`)
  }
}
if (!html.includes(commit)) {
  throw new Error('The report does not name the commit it describes')
}
// The suite leaves its command log in the case directory, so whether the tree is clean is read rather
// than assumed. Each draft reason must agree with its own cause: uncommitted changes with the tree, and
// an unsatisfied policy with the verdict the report states.
const isDirty: boolean = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0
if (html.includes('working tree has uncommitted changes') !== isDirty) {
  throw new Error(`The report ${isDirty ? 'of a dirty tree does not say so' : 'of a clean tree calls it dirty'}`)
}
const verdict: string = /<ul class="statements verdict">(.*?)<\/ul>/su.exec(html)?.[1] ?? ''
if (verdict.length === 0 || /compliant/iu.test(verdict)) {
  throw new Error('The report opens without its verdict statements, or calls the project compliant')
}
if (html.includes('satisfy the policy this report states') !== verdict.includes('<li class="fail">')) {
  throw new Error('The draft banner and the verdict disagree about the policy')
}
// A tree that changed after the inventory was written is not the tree the inventory describes.
writeFileSync('unrelated-change.txt', 'changed after the inventory\n')
try {
  requireResult(await invoke(executable, ['gate', 'compliance-report']), 1, 'does not describe the current tree')
} finally {
  rmSync('unrelated-change.txt')
}
requireResult(
  await invoke(executable, ['compliance-report', '--format', 'pdf']),
  1,
  'invalid arguments for "compliance-report"',
)
console.info('compliance report contents, provenance and refusal contracts passed')
