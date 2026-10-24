// Expand gates in registry order across their applicable members; tree verification remains last.

/** Which of the three scopes a gate judges. */
export type GateScope = 'repository' | 'package' | 'payload'

/**
 * How much one verification run checks. Each level contains the one before it: `quick` runs the static
 * gates, `delta` adds history, build, bundle and the browser suite with its sweep scoped to the change,
 * and `full` runs the same gates with the complete sweep in every engine.
 */
export type VerificationLevel = 'quick' | 'delta' | 'full'

/** The levels in the order each contains the one before it. */
export const VERIFICATION_LEVELS: readonly VerificationLevel[] = ['quick', 'delta', 'full']

/** The level a bare `ploaness verify` runs. */
export const DEFAULT_VERIFICATION_LEVEL: VerificationLevel = 'quick'

/**
 * Whether a word names a verification level.
 * @param word the word, as typed.
 * @returns true for `quick`, `delta` and `full`.
 */
export const isVerificationLevel = (word: string): word is VerificationLevel =>
  new Set<string>(VERIFICATION_LEVELS).has(word)

/**
 * Whether a run at one level includes what another level adds.
 * @param run the level the run was asked for.
 * @param required the lowest level that includes the work.
 * @returns true when the run's level is the required one or a later one.
 */
export const coversLevel = (run: VerificationLevel, required: VerificationLevel): boolean =>
  VERIFICATION_LEVELS.indexOf(run) >= VERIFICATION_LEVELS.indexOf(required)

/** One gate, reduced to what deciding the order needs. */
export interface GateDescriptor {
  readonly id: string
  readonly scope: GateScope
  /** The lowest level that runs the gate. */
  readonly level: VerificationLevel
}

/** One governed member, reduced to what deciding the order needs. */
export interface MemberDescriptor {
  readonly path: string
  readonly isPayload: boolean
}

/** One gate invocation: a gate, and the member it is asked about when it has one. */
export interface PlanStep {
  readonly gateId: string
  /** The member's path, or undefined for a repository-scope gate. */
  readonly member: string | undefined
}

/** Record only a successful build of the particular member in this invocation. */
export const recordBuildSuccess = (
  built: ReadonlySet<string>,
  step: PlanStep,
  isSuccess: boolean,
): ReadonlySet<string> =>
  isSuccess && step.gateId === 'build' && step.member !== undefined ? new Set([...built, step.member]) : built

/** Report-only execution must not test an old artifact after the current build failed. */
export const canRunBuiltBrowser = (step: PlanStep, isRuntime: boolean, built: ReadonlySet<string>): boolean =>
  !isRuntime || step.gateId !== 'e2e' || (step.member !== undefined && built.has(step.member))

// A package-scope gate asks about every member; a payload-scope gate asks only about the members that
// are Payload applications. Derived from what the member declares rather than from anything it opts
// into, so a project cannot silence the Payload rules by describing itself differently.
const membersFor = (gate: GateDescriptor, members: readonly MemberDescriptor[]): readonly MemberDescriptor[] =>
  gate.scope === 'payload' ? members.filter((member: MemberDescriptor): boolean => member.isPayload) : members

const stepsFor = (gate: GateDescriptor, members: readonly MemberDescriptor[]): readonly PlanStep[] =>
  gate.scope === 'repository'
    ? [{ gateId: gate.id, member: undefined }]
    : membersFor(gate, members).map((member: MemberDescriptor): PlanStep => ({ gateId: gate.id, member: member.path }))

/**
 * Expand the gate registry into the ordered invocations one run performs.
 *
 * For a repository with a single member this yields exactly the sequence ploaness ran before it knew
 * about members, which is the property that makes workspace support invisible to a single-package
 * project rather than merely compatible with it.
 * @param gates every gate ploaness knows, in registry order.
 * @param members the governed members, in discovery order.
 * @param level the level the run was asked for.
 * @returns one step per gate invocation, in run order.
 */
export const planSteps = (
  gates: readonly GateDescriptor[],
  members: readonly MemberDescriptor[],
  level: VerificationLevel,
): readonly PlanStep[] =>
  gates
    .filter((gate: GateDescriptor): boolean => coversLevel(level, gate.level))
    .flatMap((gate: GateDescriptor): readonly PlanStep[] => stepsFor(gate, members))
