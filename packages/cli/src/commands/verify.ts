// Verification: run the gates in order and report one verdict. A gate that throws is a failed gate, not
// a crashed run, because a tool that cannot start is indistinguishable from a tool that found a defect:
// either way the project is not verified.
import type { Context } from '../context.js'
import { failed, type GateResult } from '../exec.js'
import { type Gate, gatesFor } from '../gates.js'
import { type GateOutcome, reportFindings, reportGate, reportVerdict } from '../report.js'

const asMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const runGate = async (gate: Gate, context: Context): Promise<GateResult> => {
  try {
    return await gate.run(context)
  } catch (error: unknown) {
    return failed(`the ${gate.id} gate could not run`, [asMessage(error)])
  }
}

/**
 * Run Default or Extended verification.
 * @param context the resolved project environment.
 * @param extended whether to include the history, build, bundle, and end-to-end gates.
 * @returns the process exit code.
 */
export const verify = async (context: Context, extended: boolean): Promise<number> => {
  const gates: readonly Gate[] = gatesFor(extended)
  console.info(
    `ploaness ${extended ? 'extended' : 'default'} verification: ${gates.length} gate(s)\n`,
  )
  const outcomes: GateOutcome[] = []
  for (const gate of gates) {
    const result: GateResult = await runGate(gate, context)
    const outcome: GateOutcome = { gate, result }
    outcomes.push(outcome)
    reportGate(outcome)
    // The preflight gate decides whether ploaness may judge this project at all. Continuing past a
    // failure there would produce a page of findings about a contract the project never agreed to.
    if (gate.id === 'preflight' && !result.ok) {
      break
    }
  }
  reportFindings(outcomes)
  return reportVerdict(outcomes, extended, context.enforce)
}

/** Run one gate by identifier. A single gate is a debugging aid, never a verdict. */
export const verifyOne = async (context: Context, gate: Gate): Promise<number> => {
  const result: GateResult = await runGate(gate, context)
  const outcome: GateOutcome = { gate, result }
  reportGate(outcome)
  reportFindings([outcome])
  console.info('\nA single gate is a debugging aid. Run `ploaness verify` for a verdict.')
  return result.ok || !context.enforce ? 0 : 1
}
