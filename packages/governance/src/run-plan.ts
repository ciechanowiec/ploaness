// Expand gates in registry order across their applicable members; tree verification remains last.

/** Which of the three scopes a gate judges. */
export type GateScope = 'repository' | 'package' | 'payload'

/** One gate, reduced to what deciding the order needs. */
export interface GateDescriptor {
  readonly id: string
  readonly scope: GateScope
  readonly isExtended: boolean
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

// A package-scope gate asks about every member; a payload-scope gate asks only about the members that
// are Payload applications. Derived from what the member declares rather than from anything it opts
// into, so a project cannot silence the Payload rules by describing itself differently.
const membersFor = (
  gate: GateDescriptor,
  members: readonly MemberDescriptor[],
): readonly MemberDescriptor[] =>
  gate.scope === 'payload'
    ? members.filter((member: MemberDescriptor): boolean => member.isPayload)
    : members

const stepsFor = (
  gate: GateDescriptor,
  members: readonly MemberDescriptor[],
): readonly PlanStep[] =>
  gate.scope === 'repository'
    ? [{ gateId: gate.id, member: undefined }]
    : membersFor(gate, members).map(
        (member: MemberDescriptor): PlanStep => ({ gateId: gate.id, member: member.path }),
      )

/**
 * Expand the gate registry into the ordered invocations one run performs.
 *
 * For a repository with a single member this yields exactly the sequence ploaness ran before it knew
 * about members, which is the property that makes workspace support invisible to a single-package
 * project rather than merely compatible with it.
 * @param gates every gate ploaness knows, in registry order.
 * @param members the governed members, in discovery order.
 * @param isExtended whether extended verification's gates are included.
 * @returns one step per gate invocation, in run order.
 */
export const planSteps = (
  gates: readonly GateDescriptor[],
  members: readonly MemberDescriptor[],
  isExtended: boolean,
): readonly PlanStep[] =>
  gates
    .filter((gate: GateDescriptor): boolean => isExtended || !gate.isExtended)
    .flatMap((gate: GateDescriptor): readonly PlanStep[] => stepsFor(gate, members))
