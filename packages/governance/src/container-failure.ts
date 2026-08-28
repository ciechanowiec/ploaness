// Why a containerised gate failed, told apart from what its analyzer reported.
//
// `docker run` passes the container's own exit code through, so a gate that reads every non-zero exit as
// the tool's verdict reads a failure of Docker as a finding. The consequence was not cosmetic: a Docker
// Hub pull-rate limit - 100 anonymous pulls per six hours per IP, which several teams behind one CI
// egress reach - made the secret scan announce that it had found a secret in the git history. That is the
// one verdict a project cannot dismiss on its own judgement, and the worst thing this harness can say. A
// registry outage, an unreachable network, and a digest the registry no longer serves all landed the same
// way.
//
// Two classifiers rather than one, and the split is the actual repair. `classifyImageFailure` reads
// markers out of the output because it judges `docker image inspect` and `docker pull`, whose every byte
// docker wrote. `classifyContainerExit` judges a run of the analyzer, whose output carries content the
// PROJECT authored - a commit message, a Dockerfile, a workflow - so it reads the exit code and nothing
// else. Matching `no such host` against a commit message would invert the same bug rather than fix it.
//
// The rules are pure so they are exercised against captured `docker` output rather than against a live
// daemon: every branch below describes a failure that is expensive or impossible to stage on demand.

/** One finished invocation, reduced to what a classifier reads. */
export interface ContainerRun {
  readonly code: number
  readonly output: string
}

/** Which failure of the container toolchain a gate hit. */
export type DockerFailureKind =
  | 'absent'
  | 'daemonDown'
  | 'rateLimited'
  | 'unreachable'
  | 'manifestUnknown'
  | 'unstartable'

/** A failure of Docker itself, worded for the gate that hit it. */
export interface DockerFailure {
  readonly kind: DockerFailureKind
  readonly summary: string
  readonly remedies: readonly string[]
}

/** The exit code a shell reports for a command it cannot find. */
export const COMMAND_NOT_FOUND: number = 127

// `docker run` reserves these for a failure of docker itself, distinct from whatever the container exits
// with: 125 when docker could not run the container at all, 126 when the entry point was not executable.
// No analyzer this harness runs emits either - gitleaks, hadolint and actionlint all answer with 0 and 1 -
// so they separate docker's failure from the tool's verdict before a byte of output is read.
const DOCKER_ITSELF_FAILED: number = 125
const ENTRY_POINT_NOT_EXECUTABLE: number = 126

interface Wording {
  /** Completes the sentence that opens with the gate's name. */
  readonly suffix: string
  readonly remedies: readonly string[]
}

const WORDING: Readonly<Record<DockerFailureKind, Wording>> = {
  absent: {
    suffix: 'needs Docker, which is not installed on this machine',
    remedies: ['Docker is already required for the Payload test database; install it and retry'],
  },
  daemonDown: {
    suffix: 'needs Docker, which is installed but not running',
    remedies: ['start the Docker daemon and retry; nothing about the project has been judged yet'],
  },
  rateLimited: {
    suffix:
      'could not pull its analyzer image: the container registry is rate-limiting this network',
    remedies: [
      'Docker Hub caps anonymous pulls per IP, and a shared CI egress reaches that cap sooner than one machine does',
      'run `docker login` and retry, or retry once the window resets',
      'no analyzer ran, so this says nothing about the project',
    ],
  },
  unreachable: {
    suffix: 'could not reach the container registry to pull its analyzer image',
    remedies: [
      'this gate is fail-closed by design; retry with network access',
      'an image already pulled is reused, so a machine that has run this gate before needs no network',
    ],
  },
  manifestUnknown: {
    suffix: 'names an analyzer image the registry does not serve',
    remedies: [
      'the image is pinned by digest in ploaness, not by the project',
      'this is a ploaness packaging defect; report it',
    ],
  },
  unstartable: {
    suffix: 'could not start its analyzer container',
    remedies: ['docker refused to run the image; no analyzer ran, so no finding has been made'],
  },
}

const failureFor = (kind: DockerFailureKind, gate: string): DockerFailure => ({
  kind,
  summary: `${gate} ${WORDING[kind].suffix}`,
  remedies: WORDING[kind].remedies,
})

// Ordered, because the first match wins and the categories are not disjoint in principle: a rate-limited
// pull and an unreachable registry both mention the registry host. The more specific cause is listed
// first so it is the one reported.
//
// `manifestUnknown` sits BELOW `unreachable` for that same rule read the other way round. Docker frames
// every registry failure the same way - `failed to resolve reference "<ref>": <cause>` - so a bad
// digest, a refused connection and a host that does not resolve all carry that opening, and only the
// clause after the colon says which one happened. The frame is therefore the LEAST specific marker here
// rather than the most, and matching it above the transport markers would report a ploaness packaging
// defect for a team's network outage: the same misattribution this classifier exists to prevent, moved
// one category over.
const MARKERS: readonly (readonly [DockerFailureKind, readonly string[]])[] = [
  ['absent', ['enoent', 'command not found', 'executable file not found']],
  [
    'daemonDown',
    [
      'cannot connect to the docker daemon',
      'is the docker daemon running',
      'error during connect',
      'docker daemon is not running',
    ],
  ],
  ['rateLimited', ['toomanyrequests', 'pull rate limit', 'too many requests']],
  [
    'unreachable',
    [
      'dial tcp',
      'no such host',
      'i/o timeout',
      'tls handshake',
      'connection refused',
      'network is unreachable',
      'temporary failure in name resolution',
    ],
  ],
  [
    'manifestUnknown',
    [
      'manifest unknown',
      'not found: manifest',
      'repository does not exist',
      'failed to resolve reference',
    ],
  ],
]

/**
 * Classify a failure of `docker image inspect` or `docker pull`.
 *
 * Safe to read the output here, and only here: the command is docker's own and every byte it wrote is
 * docker's. Acquiring the image as a step of its own is what creates that guarantee - it moves "the
 * analyzer could not run" onto a different command from "the analyzer found something", so the two stop
 * being one exit code read two ways.
 * @param gate the gate's name, opening the sentence the summary completes.
 * @param invocation the finished `docker` invocation.
 * @returns the failure, or undefined when the image was acquired.
 */
export const classifyImageFailure = (
  gate: string,
  invocation: ContainerRun,
): DockerFailure | undefined => {
  if (invocation.code === 0) {
    return undefined
  }
  if (invocation.code === COMMAND_NOT_FOUND) {
    return failureFor('absent', gate)
  }
  const haystack: string = invocation.output.toLowerCase()
  const matched: readonly [DockerFailureKind, readonly string[]] | undefined = MARKERS.find(
    ([, markers]: readonly [DockerFailureKind, readonly string[]]): boolean =>
      markers.some((marker: string): boolean => haystack.includes(marker)),
  )
  return failureFor(matched === undefined ? 'unstartable' : matched[0], gate)
}

/**
 * Classify a failure of a run whose output the project may have authored.
 *
 * Exit code only. gitleaks prints the commit it found a secret in, hadolint prints the Dockerfile line,
 * actionlint prints the workflow step - so a marker matched against that output would let a commit
 * message decide whether a real finding is reported, which is the same defect one level deeper. The codes
 * `docker run` reserves for itself carry no such ambiguity.
 * @param gate the gate's name, opening the sentence the summary completes.
 * @param invocation the finished `docker run` or shell invocation.
 * @returns the failure, or undefined when the exit code is the tool's own verdict.
 */
export const classifyContainerExit = (
  gate: string,
  invocation: ContainerRun,
): DockerFailure | undefined => {
  if (invocation.code === COMMAND_NOT_FOUND) {
    return failureFor('absent', gate)
  }
  return invocation.code === DOCKER_ITSELF_FAILED || invocation.code === ENTRY_POINT_NOT_EXECUTABLE
    ? failureFor('unstartable', gate)
    : undefined
}
