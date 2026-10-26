// The workers this machine gives the browser sweep, and so the parts each pass is split into. Every process
// of a run asks the same machine, so the runner and each worker agree on how many parts there are.
import { availableParallelism, totalmem } from 'node:os'
import { sweepWorkersFor } from '@ploaness/governance'

/** The workers a browser run spreads the sweep over, which is also the number of parts of each pass. */
export const SWEEP_WORKERS: number = sweepWorkersFor(availableParallelism(), totalmem())
