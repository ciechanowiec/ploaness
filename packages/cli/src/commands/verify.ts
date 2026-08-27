// Verification: run the gates in order and report one verdict. A gate that throws is a failed gate, not
// a crashed run, because a tool that cannot start is indistinguishable from a tool that found a defect:
// either way the project is not verified.
import { endsRun } from '@ploaness/governance'
import type { Member, Repository as Repo } from '../context.js'
import { failed, type GateResult } from '../exec.js'
import { type PlannedGate, planFor } from '../gates.js'
import {
  beginGate,
  type GateOutcome,
  reportGate,
  reportHalt,
  reportHeader,
  reportNote,
  reportOutput,
  reportVerdict,
} from '../report.js'

const asMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// The union is narrowed exactly here, once. Everywhere else a gate is a gate; this is the one place
// that has to know a repository-scope gate is handed the repository and a member-scope gate its member.
const invoke = async (planned: PlannedGate, repo: Repo): Promise<GateResult> => {
  if (planned.gate.scope === 'repository') {
    return await planned.gate.run(repo)
  }
  const member: Member | undefined = planned.member
  if (member === undefined) {
    return failed(`the ${planned.gate.id} gate was planned without a member`, [
      'this is a ploaness defect; the run plan and the registry disagree about this gate',
    ])
  }
  return await planned.gate.run(member)
}

const runGate = async (planned: PlannedGate, repo: Repo): Promise<GateResult> => {
  try {
    return await invoke(planned, repo)
  } catch (error: unknown) {
    return failed(`the ${planned.gate.id} gate could not run`, [asMessage(error)])
  }
}

/** Time one gate and package it as the outcome the report layer prints. */
const timeGate = async (planned: PlannedGate, repo: Repo): Promise<GateOutcome> => {
  const started: number = Date.now()
  const result: GateResult = await runGate(planned, repo)
  return {
    gate: planned.gate,
    result,
    durationMs: Date.now() - started,
    member: planned.member?.path,
  }
}

// The identifier column is sized to the widest gate in this run rather than to a fixed constant, so
// adding a longer gate identifier cannot silently push the summaries out of alignment.
const identifierWidth = (planned: readonly PlannedGate[]): number =>
  planned.reduce(
    (widest: number, step: PlannedGate): number => Math.max(widest, step.gate.id.length),
    0,
  )

// A sequence with an exit rather than a plain map, because a run does not always reach the end. The
// rule that decides is `endsRun`, in governance; this supplies the outcome and the mode.
const runPlan = async (
  planned: readonly PlannedGate[],
  repo: Repo,
  width: number,
): Promise<readonly GateOutcome[]> => {
  const [step, ...rest] = planned
  if (step === undefined) {
    return []
  }
  beginGate(step.gate, width)
  const outcome: GateOutcome = await timeGate(step, repo)
  reportGate(outcome, width)
  const isPrecondition: boolean = step.gate.isPrecondition === true
  if (
    endsRun({
      isFailure: !outcome.result.ok,
      isPrecondition,
      isEnforced: repo.isEnforced,
    })
  ) {
    reportHalt(step.gate, rest.length, isPrecondition)
    return [outcome]
  }
  return [outcome, ...(await runPlan(rest, repo, width))]
}

/**
 * Run Default or Extended verification.
 * @param repository the resolved repository environment.
 * @param isExtended whether to include the history, build, bundle, and end-to-end gates.
 * @returns the process exit code.
 */
export const verify = async (repository: Repo, isExtended: boolean): Promise<number> => {
  const planned: readonly PlannedGate[] = planFor(repository, isExtended)
  const width: number = identifierWidth(planned)
  reportHeader(isExtended, planned.length)
  const outcomes: readonly GateOutcome[] = await runPlan(planned, repository, width)
  return reportVerdict(outcomes, isExtended, repository.isEnforced)
}

/**
 * Run one gate by identifier. A single gate is a debugging aid, never a verdict.
 * @param repository the resolved repository environment.
 * @param planned the gate to run, with the member it is about.
 * @param isVerbose whether to print what the gate's tool wrote, not only the verdict it produced.
 * @returns the process exit code.
 */
export const verifyOne = async (
  repository: Repo,
  planned: PlannedGate,
  isVerbose: boolean = false,
): Promise<number> => {
  const outcome: GateOutcome = await timeGate(planned, repository)
  reportGate(outcome, planned.gate.id.length)
  if (isVerbose) {
    reportOutput(outcome)
  }
  reportNote('A single gate is a debugging aid. Run `ploaness verify` for a verdict.')
  return outcome.result.ok || !repository.isEnforced ? 0 : 1
}
