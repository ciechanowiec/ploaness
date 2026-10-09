// Verification: run the gates in order and report one verdict. A gate that throws is a failed gate, not
// a crashed run, because a tool that cannot start is indistinguishable from a tool that found a defect:
// either way the project is not verified.
import { canRunBuiltBrowser, endsRun, type PlanStep, recordBuildSuccess } from '@ploaness/governance'
import { browserReadiness } from '../checks/tests.js'
import { hasOwnRuntime, type Member, type Repository } from '../context.js'
import { failed, type GateResult } from '../exec.js'
import { type Gate, gateById, type PlannedGate, planFor } from '../gates.js'
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

const asMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// The union is narrowed exactly here, once. Everywhere else a gate is a gate; this is the one place
// that has to know a repository-scope gate is handed the repository and a member-scope gate its member.
const invoke = async (planned: PlannedGate, repository: Repository): Promise<GateResult> => {
  if (planned.gate.scope === 'repository') {
    return await planned.gate.run(repository)
  }
  const member: Member | undefined = planned.member
  if (member === undefined) {
    return failed(`the ${planned.gate.id} gate was planned without a member`, [
      'this is a ploaness defect; the run plan and the registry disagree about this gate',
    ])
  }
  return await planned.gate.run(member)
}

const runGate = async (
  planned: PlannedGate,
  repository: Repository,
  built?: ReadonlySet<string>,
): Promise<GateResult> => {
  try {
    const step: PlanStep = { gateId: planned.gate.id, member: planned.member?.path }
    const isRuntime: boolean = planned.member !== undefined && hasOwnRuntime(planned.member)
    if (built !== undefined && !canRunBuiltBrowser(step, isRuntime, built)) {
      return failed('this run did not establish a production build for the browser suite', [
        'repair the build failure and rerun full verification',
      ])
    }
    return await invoke(planned, repository)
  } catch (error: unknown) {
    return failed(`the ${planned.gate.id} gate could not run`, [asMessage(error)])
  }
}

/** Time one gate and package it as the outcome the report layer prints. */
const timeGate = async (
  planned: PlannedGate,
  repository: Repository,
  built?: ReadonlySet<string>,
): Promise<GateOutcome> => {
  const started: number = Date.now()
  const result: GateResult = await runGate(planned, repository, built)
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
  planned.reduce((widest: number, step: PlannedGate): number => Math.max(widest, step.gate.id.length), 0)

// A sequence with an exit rather than a plain map, because a run does not always reach the end. The
// rule that decides is `endsRun`, in governance; this supplies the outcome and the mode.
const runPlan = async (
  planned: readonly PlannedGate[],
  repository: Repository,
  width: number,
  built: ReadonlySet<string> = new Set(),
): Promise<readonly GateOutcome[]> => {
  const [step, ...rest] = planned
  if (step === undefined) {
    return []
  }
  beginGate(step.gate, width)
  const outcome: GateOutcome = await timeGate(step, repository, built)
  reportGate(outcome, width)
  const isPrecondition: boolean = step.gate.isPrecondition === true
  if (
    endsRun({
      isFailure: !outcome.result.ok,
      isPrecondition,
      isEnforced: repository.isEnforced,
    })
  ) {
    reportHalt(step.gate, rest.length, isPrecondition)
    return [outcome]
  }
  const nextBuilt: ReadonlySet<string> = recordBuildSuccess(
    built,
    { gateId: step.gate.id, member: step.member?.path },
    outcome.result.ok,
  )
  return [outcome, ...(await runPlan(rest, repository, width, nextBuilt))]
}

/**
 * Run Default or Extended verification.
 * @param repository the resolved repository environment.
 * @param isExtended whether to include the history, build, bundle, and end-to-end gates.
 * @returns the process exit code.
 */
export const verify = async (repository: Repository, isExtended: boolean): Promise<number> => {
  const started: number = Date.now()
  const planned: readonly PlannedGate[] = planFor(repository, isExtended)
  const width: number = identifierWidth(planned)
  reportHeader(isExtended, planned.length)
  const outcomes: readonly GateOutcome[] = await runPlan(planned, repository, width)
  return reportVerdict(outcomes, isExtended, repository.isEnforced, Date.now() - started)
}

const hasBrowserBuild = async (repository: Repository, planned: PlannedGate): Promise<boolean> => {
  const started: number = Date.now()
  const readiness: GateResult | undefined =
    planned.member === undefined ? undefined : await browserReadiness(planned.member)
  if (readiness !== undefined) {
    reportGate(
      { gate: planned.gate, result: readiness, durationMs: Date.now() - started, member: planned.member?.path },
      planned.gate.id.length,
    )
    return false
  }
  const buildGate: Gate | undefined = gateById('build')
  if (buildGate === undefined) {
    throw new Error('the e2e prerequisite build gate is missing')
  }
  const built: GateOutcome = await timeGate({ gate: buildGate, member: planned.member }, repository)
  reportGate(built, buildGate.id.length)
  return built.result.ok
}

/**
 * Run one gate by identifier. A single gate is a debugging aid, never a verdict.
 * @param repository the resolved repository environment.
 * @param planned the gate to run, with the member it is about.
 * @param isVerbose whether to print what the gate's tool wrote, not only the verdict it produced.
 * @returns the process exit code.
 */
export const verifyOne = async (
  repository: Repository,
  planned: PlannedGate,
  isVerbose: boolean = false,
): Promise<number> => {
  if (planned.gate.id === 'e2e' && !(await hasBrowserBuild(repository, planned))) {
    return 1
  }
  const outcome: GateOutcome = await timeGate(planned, repository)
  reportGate(outcome, planned.gate.id.length)
  if (isVerbose) {
    reportOutput(outcome)
  }
  reportNote('A single gate is a debugging aid. Run `ploaness verify` for a verdict.')
  return outcome.result.ok || !repository.isEnforced ? 0 : 1
}
