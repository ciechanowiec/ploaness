// Prints the name of the variable that hands a `delta` run's change scope to the browser sweep, so the
// suite names it from the constant both sides read rather than from a copy of its own.
import { SWEEP_SCOPE_ENVIRONMENT_VARIABLE } from '@ploaness/governance'

process.stdout.write(`${SWEEP_SCOPE_ENVIRONMENT_VARIABLE}\n`)
