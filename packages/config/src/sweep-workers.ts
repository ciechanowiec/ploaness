// The workers the browser sweep runs on, and so the parts each pass is split into. Under the e2e gate the
// run has measured both the host and the machine the browsers run in and says how many; a suite run any
// other way asks this host. Every process of a run reads the same answer, so the runner and its workers
// agree on the parts.
import { availableParallelism, totalmem } from 'node:os'
import { declaredSweepWorkers, SWEEP_WORKERS_ENVIRONMENT_VARIABLE, sweepWorkersFor } from '@ploaness/governance'

/** The workers a browser run spreads the sweep over, which is also the number of parts of each pass. */
export const SWEEP_WORKERS: number =
  declaredSweepWorkers(process.env[SWEEP_WORKERS_ENVIRONMENT_VARIABLE]) ??
  sweepWorkersFor(availableParallelism(), totalmem())
