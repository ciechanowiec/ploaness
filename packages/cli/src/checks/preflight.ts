// The gate that runs before every other one. ploaness governs Payload CMS projects, so it refuses to
// judge a project that is not one. Running anyway would produce a verdict about a contract the project
// never agreed to.

import { asRecord } from '@ploaness/governance'
import type { Context } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

const MINIMUM_NODE_MAJOR: number = 26

const declaredDependencies = (packageJson: unknown): Record<string, unknown> => {
  const root: Record<string, unknown> = asRecord(packageJson)
  return { ...asRecord(root['dependencies']), ...asRecord(root['devDependencies']) }
}

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
  const findings: readonly string[] = [
    ...projectFindings,
    ...(nodeMajor < MINIMUM_NODE_MAJOR
      ? [`Node ${process.versions.node} is below the required ${String(MINIMUM_NODE_MAJOR)}`]
      : []),
  ]
  return findings.length > 0
    ? failed('project is not a supported Payload application', findings)
    : passed(`Payload project on Node ${process.versions.node}`)
}
