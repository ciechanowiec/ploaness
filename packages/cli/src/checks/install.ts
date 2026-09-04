// Install-script allowlist. The decision lives in governance; this reads the two files pnpm accepts it in.
//
// Left undeclared, every package in the resolved set may run a build or postinstall script during
// `pnpm install` - the broadest surface a project has for executing code it never called. The gate
// requires the allowlist to exist and says nothing about what is on it: which packages a project trusts
// with an install script is a decision for the project to record, not one the harness can make for it.
import { declaresInstallScriptAllowlist, findReleaseAgeViolations } from '@ploaness/governance'
import type { Repository as Repo } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

const WORKSPACE_FILE: string = 'pnpm-workspace.yaml'

// The workspace file arrives already read, from the repository root. It used to be read relative to
// whatever directory the run started in, which in a workspace member is a directory the file cannot be
// in - and pnpm honours `pnpm.onlyBuiltDependencies` only at the root too, so the finding advised
// declaring the key somewhere it would have no effect.
/** The repository must name the dependencies permitted to run an install script. */
export const installScripts = (repo: Repo): GateResult =>
  declaresInstallScriptAllowlist(repo.workspaceFile, repo.packageJson)
    ? passed('the dependencies permitted to run an install script are declared')
    : failed('no install-script allowlist is declared', [
        `declare onlyBuiltDependencies in ${WORKSPACE_FILE}, or under the "pnpm" key of package.json`,
        'an empty list is a valid answer: it permits no dependency to run an install script',
      ])

// The same file, read the same way, for the other half of install policy: what pnpm may install at all.
// The decisions are in `install-policy.ts`; this hands over the file and names the gate.
/** The repository must keep pnpm's release-age floor strict, and may exempt only the harness from it. */
export const releaseAge = (repo: Repo): GateResult => {
  const findings: readonly string[] = findReleaseAgeViolations(repo.workspaceFile)
  return findings.length > 0
    ? failed(
        `${String(findings.length)} release-age setting(s) weaken the floor pnpm enforces`,
        findings,
      )
    : passed('the release-age floor is strict, and only the harness is excluded from it')
}
