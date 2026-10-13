import path from 'node:path'
import { DEFAULT_REPORT_OUTPUT } from '@ploaness/governance'
import { type WrittenReport, writeComplianceReport } from '../compliance-report.js'
import type { Repository } from '../context.js'
import { type GateResult, passed } from '../exec.js'

/** Full verification writes the shareable compliance report from the inventory the `sbom` gate wrote. */
export const complianceReport = async (repository: Repository): Promise<GateResult> => {
  const written: WrittenReport = await writeComplianceReport(repository, {
    output: path.join(repository.root, DEFAULT_REPORT_OUTPUT),
    sbomDirectory: path.join(repository.root, 'dist/sbom'),
  })
  const names: string = written.files.map((file: string): string => path.basename(file)).join(' and ')
  return passed(
    `Compliance report written to ${written.directory}: ${names}` +
      (written.pdfSkipped === undefined ? '' : `; no PDF, because ${written.pdfSkipped}`),
  )
}
