// The gate that runs before every other one. ploaness governs Payload CMS projects, so it refuses to
// judge a project that is not one. Running anyway would produce a verdict about a contract the project
// never agreed to.

import {
  asOptionalText,
  asStringRecord,
  findPayloadMemberViolations,
  findPnpmRuntimeViolations,
  type MemberShape,
  minimumNodeMajor,
  pinnedPnpmVersion,
} from '@ploaness/governance'
import { type Member, type Repository, readPins } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

// Read from `pins.json`, not written here. The floor was a constant in this file, which made it a rule
// living in the I/O layer and a fourth copy of a number the pins already state - and this copy is the
// one that decided a verdict, so it was the copy that could silently disagree with `engines.node`.
const requiredNodeMajor = (): number | undefined =>
  minimumNodeMajor(asStringRecord(readPins()['engines'])['node'])

// The pnpm this run is executing under, which is a different fact from the one the wiring gate reads.
// `packageManager` is what the project DECLARES, and Corepack obeys it only where Corepack is enabled;
// this is what actually resolved the tree every later gate then judges. Read from the pin rather than
// from `engines.pnpm`, which is derived from the same field.
const requiredPnpm = (): string | undefined =>
  pinnedPnpmVersion(asOptionalText(readPins()['packageManager']))

// The two questions preflight asks about the project itself, separated from the runtime question so
// neither has to accumulate into a shared list.
// Asked of the REPOSITORY rather than of one directory. A workspace legitimately holds packages that
// are not Payload applications - a shared library, a frontend reading the CMS over HTTP - and refusing
// each of those individually would refuse the repository they belong to. What ploaness still will not
// judge is a repository with no Payload in it anywhere, which is the same refusal, one level up.
const projectProblems = (repository: Repository): readonly string[] => {
  if (repository.packageJson === undefined) {
    return ['no package.json found; run ploaness from the repository root']
  }
  return findPayloadMemberViolations(
    repository.members.map(
      (member: Member): MemberShape => ({
        path: member.path,
        isPayload: member.isPayload,
        sourceRoots: member.settings.sourceRoots,
      }),
    ),
  )
}

/** Verify the project is a Payload application on a supported runtime. */
export const preflight = (context: Repository): GateResult => {
  const projectFindings: readonly string[] = projectProblems(context)
  const nodeMajor: number = Number(process.versions.node.split('.', 1)[0] ?? '0')
  const required: number | undefined = requiredNodeMajor()
  const findings: readonly string[] = [
    ...projectFindings,
    ...(required !== undefined && nodeMajor < required
      ? [`Node ${process.versions.node} is below the required ${String(required)}`]
      : []),
    ...findPnpmRuntimeViolations(process.env['npm_config_user_agent'], requiredPnpm()),
  ]
  return findings.length > 0
    ? failed('project is not a supported Payload application on a pinned toolchain', findings)
    : passed(`Payload project on Node ${process.versions.node}`)
}
