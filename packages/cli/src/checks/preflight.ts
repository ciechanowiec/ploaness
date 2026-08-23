// The gate that runs before every other one. ploaness governs Payload CMS projects, so it refuses to
// judge a project that is not one. Running anyway would produce a verdict about a contract the project
// never agreed to.

import type { Context } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

const MINIMUM_NODE_MAJOR: number = 26

const asRecord = (raw: unknown): Record<string, unknown> =>
  typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}

const declaredDependencies = (packageJson: unknown): Record<string, unknown> => {
  const root: Record<string, unknown> = asRecord(packageJson)
  return { ...asRecord(root['dependencies']), ...asRecord(root['devDependencies']) }
}

/** Verify the project is a Payload application on a supported runtime. */
export const preflight = (context: Context): GateResult => {
  const findings: string[] = []
  if (context.packageJson === undefined) {
    findings.push('no package.json found; run ploaness from the repository root')
  } else if (!Object.hasOwn(declaredDependencies(context.packageJson), 'payload')) {
    findings.push(
      'this project does not declare "payload"; ploaness governs Payload CMS projects and will not judge another kind',
    )
  }
  const nodeMajor: number = Number(process.versions.node.split('.')[0] ?? '0')
  if (nodeMajor < MINIMUM_NODE_MAJOR) {
    findings.push(`Node ${process.versions.node} is below the required ${MINIMUM_NODE_MAJOR}`)
  }
  return findings.length > 0
    ? failed('project is not a supported Payload application', findings)
    : passed(`Payload project on Node ${process.versions.node}`)
}
