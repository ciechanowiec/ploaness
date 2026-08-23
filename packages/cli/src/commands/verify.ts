// Verification: run the gates in order and report one verdict. A gate that throws is a failed gate, not
// a crashed run, because a tool that cannot start is indistinguishable from a tool that found a defect:
// either way the project is not verified.
import type { Context } from '../context.js'
import { failed, type GateResult } from '../exec.js'
import { type Gate, gatesFor } from '../gates.js'
import {
  beginGate,
  type GateOutcome,
  reportFindings,
  reportGate,
  reportHeader,
  reportNote,
  reportVerdict,
} from '../report.js'

const asMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const runGate = async (gate: Gate, context: Context): Promise<GateResult> => {
  try {
    return await gate.run(context)
  } catch (error: unknown) {
    return failed(`the ${gate.id} gate could not run`, [asMessage(error)])
  }
}

/** Time one gate and package it as the outcome the report layer prints. */
const timeGate = async (gate: Gate, context: Context): Promise<GateOutcome> => {
  const started: number = Date.now()
  const result: GateResult = await runGate(gate, context)
  return { gate, result, durationMs: Date.now() - started }
}

// The identifier column is sized to the widest gate in this run rather than to a fixed constant, so
// adding a longer gate identifier cannot silently push the summaries out of alignment.
const identifierWidth = (gates: readonly Gate[]): number =>
  gates.reduce((widest: number, gate: Gate): number => Math.max(widest, gate.id.length), 0)

/**
 * Run Default or Extended verification.
 * @param context the resolved project environment.
 * @param extended whether to include the history, build, bundle, and end-to-end gates.
 * @returns the process exit code.
 */
export const verify = async (context: Context, extended: boolean): Promise<number> => {
  const gates: readonly Gate[] = gatesFor(extended)
  const width: number = identifierWidth(gates)
  reportHeader(extended, gates.length)
  const outcomes: GateOutcome[] = []
  for (const gate of gates) {
    beginGate(gate, width)
    const outcome: GateOutcome = await timeGate(gate, context)
    outcomes.push(outcome)
    reportGate(outcome, width)
    // The preflight gate decides whether ploaness may judge this project at all. Continuing past a
    // failure there would produce a page of findings about a contract the project never agreed to.
    if (gate.id === 'preflight' && !outcome.result.ok) {
      break
    }
  }
  reportFindings(outcomes)
  return reportVerdict(outcomes, extended, context.enforce)
}

/** Run one gate by identifier. A single gate is a debugging aid, never a verdict. */
export const verifyOne = async (context: Context, gate: Gate): Promise<number> => {
  const outcome: GateOutcome = await timeGate(gate, context)
  reportGate(outcome, gate.id.length)
  reportFindings([outcome])
  reportNote('A single gate is a debugging aid. Run `ploaness verify` for a verdict.')
  return outcome.result.ok || !context.enforce ? 0 : 1
}
