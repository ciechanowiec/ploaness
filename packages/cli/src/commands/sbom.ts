import { parseSbomArguments, type SbomArguments } from '@ploaness/governance'
import type { Repository } from '../context.js'
import { writeSbom } from '../sbom.js'

/** Produce a release-associated workspace inventory without changing the source or its installation. */
export const sbom = (repository: Repository, arguments_: readonly string[]): number => {
  const options: SbomArguments | undefined = parseSbomArguments(arguments_)
  if (options === undefined) {
    throw new Error('usage: ploaness sbom --artifact <file> [--artifact <file> ...] [--output <directory>]')
  }
  const destination: string = writeSbom(repository, options)
  console.info(`SBOM and release metadata written to ${destination}`)
  return 0
}
