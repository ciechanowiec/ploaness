import path from 'node:path'
import { parseComplianceReportArguments } from '@ploaness/governance'
import { type WrittenReport, writeComplianceReport } from '../compliance-report.js'
import type { Repository } from '../context.js'
import { writeSbom } from '../sbom.js'

const SBOM_DIRECTORY: string = 'dist/sbom'

/** Regenerate the SBOM for the current tree, then the compliance report that embeds it. */
export const complianceReport = async (repository: Repository, arguments_: readonly string[]): Promise<number> => {
  const options: { readonly output: string } | undefined = parseComplianceReportArguments(arguments_)
  if (options === undefined) {
    throw new Error('usage: ploaness compliance-report [--output <directory>]')
  }
  writeSbom(repository, { artifacts: [], output: path.join(repository.root, SBOM_DIRECTORY) })
  const written: WrittenReport = await writeComplianceReport(repository, {
    output: options.output,
    sbomDirectory: path.join(repository.root, SBOM_DIRECTORY),
  })
  for (const file of written.files) {
    console.info(`Compliance report written to ${file}`)
  }
  if (written.pdfSkipped !== undefined) {
    console.info(`No PDF was rendered: ${written.pdfSkipped}`)
  }
  return 0
}
