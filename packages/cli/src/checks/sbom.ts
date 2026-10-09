import path from 'node:path'
import type { Repository } from '../context.js'
import { type GateResult, passed } from '../exec.js'
import { writeSbom } from '../sbom.js'

/** Full verification requires a fresh workspace inventory without assuming a release package format. */
export const sbomInventory = (repository: Repository): GateResult => {
  const destination: string = writeSbom(repository, {
    artifacts: [],
    output: path.join(repository.root, 'dist/sbom'),
  })
  return passed(`SBOM inventory and source metadata written to ${destination}`)
}
