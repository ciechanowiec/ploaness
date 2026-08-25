// The gate that runs before every other one. ploaness governs Payload CMS projects, so it refuses to
// judge a project that is not one. Running anyway would produce a verdict about a contract the project
// never agreed to.

import { asStringRecord, declaredDependencies, minimumNodeMajor } from '@ploaness/governance'
import { type Context, readPins } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

// Read from `pins.json`, not written here. The floor was a constant in this file, which made it a rule
// living in the I/O layer and a fourth copy of a number the pins already state - and this copy is the
// one that decided a verdict, so it was the copy that could silently disagree with `engines.node`.
const requiredNodeMajor = (): number | undefined =>
  minimumNodeMajor(asStringRecord(readPins()['engines'])['node'])

// The two questions preflight asks about the project itself, separated from the runtime question so
// neither has to accumulate into a shared list.
const projectProblems = (context: Context): readonly string[] => {
  if (context.packageJson === undefined) {
    return ['no package.json found; run ploaness from the repository root']
  }
  return Object.hasOwn(declaredDependencies(context.packageJson), 'payload')
    ? []
    : [
        'this project does not declare "payload"; ploaness governs Payload CMS projects ' +
          'and will not judge another kind',
      ]
}

/** Verify the project is a Payload application on a supported runtime. */
export const preflight = (context: Context): GateResult => {
  const projectFindings: readonly string[] = projectProblems(context)
  const nodeMajor: number = Number(process.versions.node.split('.', 1)[0] ?? '0')
  const required: number | undefined = requiredNodeMajor()
  const findings: readonly string[] = [
    ...projectFindings,
    ...(required !== undefined && nodeMajor < required
      ? [`Node ${process.versions.node} is below the required ${String(required)}`]
      : []),
  ]
  return findings.length > 0
    ? failed('project is not a supported Payload application', findings)
    : passed(`Payload project on Node ${process.versions.node}`)
}
