// Compare two snapshots `geometry-probe.ts` wrote on different architectures. They must agree within
// the tolerance every geometry rule allows, or a verdict measured on one machine would not hold on the
// other.
import { readFileSync } from 'node:fs'
import { instability, type LayoutSnapshot } from '@ploaness/governance'

const ARGUMENT_OFFSET: number = 2
const [first, second]: readonly (string | undefined)[] = process.argv.slice(ARGUMENT_OFFSET)
if (first === undefined || second === undefined) {
  throw new Error('Expected two snapshot files')
}

const read = (file: string): LayoutSnapshot => JSON.parse(readFileSync(file, 'utf8')) as LayoutSnapshot

const difference: string | undefined = instability(read(first), read(second))
if (difference !== undefined) {
  throw new Error(`the two architectures measured different geometry: ${difference}`)
}
console.info('the two architectures agree within the geometry tolerance')
