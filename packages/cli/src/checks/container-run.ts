// Acquiring an analyzer image, and deciding whether a failed run was the tool's fault or docker's.
//
// Shared rather than private to one gate: every containerised analyzer needs both answers, and a second
// copy of either would be a second opinion about what "docker is unavailable" means. The reasoning each
// carries is the reason it exists, so it travels with the function rather than staying behind.
import {
  classifyContainerExit,
  classifyImageFailure,
  type DockerFailure,
} from '@ploaness/governance'
import type { Context } from '../context.js'
import { failed, type GateResult, type RunResult, run } from '../exec.js'

/** A docker failure, as the verdict a gate returns for it. */
export const describeFailure = (failure: DockerFailure): GateResult =>
  failed(failure.summary, failure.remedies)

// The image is acquired as a step of its own, BEFORE any analyzer runs, and that ordering is the repair
// rather than an optimisation. It puts "the analyzer could not be obtained" on a command whose output
// docker wrote in full, so the failure can be read honestly; leaving the pull implicit in `docker run`
// left one exit code carrying two questions, and a rate-limited pull answered the wrong one - the secret
// scan reported a secret in the git history because gitleaks had never started.
//
// `docker image inspect` is local and costs nothing on a machine that has already pulled, which is every
// machine after the first run.
/**
 * Make an analyzer image available, reporting why it could not be.
 * @param context the repository or member being judged, for the working directory.
 * @param image the digest-pinned reference to acquire.
 * @param gate what to call this gate in a failure, so the message names the check that stopped.
 * @returns a failing result when the image cannot be obtained, or undefined when it is present.
 */
export const acquireImage = (
  context: Context,
  image: string,
  gate: string,
): GateResult | undefined => {
  const present: RunResult = run('docker', ['image', 'inspect', '--format', '{{.Id}}', image], {
    cwd: context.root,
  })
  if (present.code === 0) {
    return undefined
  }
  const pulled: RunResult = run('docker', ['pull', image], { cwd: context.root })
  const failure: DockerFailure | undefined = classifyImageFailure(gate, pulled)
  return failure === undefined ? undefined : describeFailure(failure)
}

// Asked only when a run failed, and answered by docker rather than by the analyzer's output. The reserved
// exit codes settle it outright; otherwise the question is whether docker is STILL well, which closes the
// narrow window where the daemon dies between the pull and the run without letting a commit message the
// scanner quoted decide whether a finding is real.
/**
 * Whether a failed run was docker's fault rather than the project's.
 * @param context the repository or member being judged.
 * @param image the image the run used, re-checked when the exit code is not a reserved one.
 * @param gate what to call this gate in a failure.
 * @param result the outcome of the run.
 * @returns a failing result when docker is at fault, or undefined when the finding is the project's.
 */
export const dockerFault = (
  context: Context,
  image: string,
  gate: string,
  result: RunResult,
): GateResult | undefined => {
  if (result.code === 0) {
    return undefined
  }
  const reserved: DockerFailure | undefined = classifyContainerExit(gate, result)
  return reserved === undefined ? acquireImage(context, image, gate) : describeFailure(reserved)
}
