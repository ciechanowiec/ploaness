// Captured `docker` output, because every case here is a failure that cannot be staged on demand: a
// Docker Hub rate limit arrives on the hundredth pull of a six-hour window, a stopped daemon has to be
// stopped, and a digest the registry no longer serves cannot be produced at all.
//
// The case that decides whether the repair worked is `reportsNoFailureForAGitleaksFinding`: the defect
// was a real scan being reported as a Docker failure and a Docker failure being reported as a real scan,
// so a classifier that fixed one direction and broke the other would be no better than what it replaced.
import { describe, expect, it } from 'vitest'
import {
  COMMAND_NOT_FOUND,
  classifyContainerExit,
  classifyImageFailure,
  type DockerFailure,
} from '../src/container-failure.js'

const GATE: string = 'the secret scan'

// The opening docker puts on every registry failure, shared by the three cases below so that what
// differs between them is only the cause after the colon - which is the whole of what is under test.
const RESOLVE: string = 'Error response from daemon: failed to resolve reference '

const kindOf = (failure: DockerFailure | undefined): string | undefined => failure?.kind

describe('classifyImageFailure', (): void => {
  it('reportsNoFailureWhenTheImageWasAcquired', (): void => {
    expect(classifyImageFailure(GATE, { code: 0, output: 'sha256:abc' })).toBeUndefined()
  })

  it('namesAnAbsentDockerBinary', (): void => {
    expect(
      kindOf(
        classifyImageFailure(GATE, { code: COMMAND_NOT_FOUND, output: 'spawnSync docker ENOENT' }),
      ),
    ).toBe('absent')
  })

  it('namesAStoppedDaemonRatherThanAMissingBinary', (): void => {
    expect(
      kindOf(
        classifyImageFailure(GATE, {
          code: 1,
          output:
            'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
        }),
      ),
    ).toBe('daemonDown')
  })

  // The finding this whole module exists for. Anonymous pulls are capped per IP, so several teams behind
  // one CI egress reach the cap on a day nobody changed anything.
  it('namesARateLimitedRegistry', (): void => {
    expect(
      kindOf(
        classifyImageFailure(GATE, {
          code: 1,
          output:
            'toomanyrequests: You have reached your unauthenticated pull rate limit. https://www.docker.com/increase-rate-limit',
        }),
      ),
    ).toBe('rateLimited')
  })

  it('namesAnUnreachableRegistry', (): void => {
    expect(
      kindOf(
        classifyImageFailure(GATE, {
          code: 1,
          output:
            'Error response from daemon: Get "https://registry-1.docker.io/v2/": dial tcp: lookup registry-1.docker.io: no such host',
        }),
      ),
    ).toBe('unreachable')
  })

  // The digests live in `toolchain-pins.ts`, so this one cannot be the project's fault whatever else is
  // true, and the wording has to say so rather than leave a team looking at their own tree.
})

// Docker frames every registry failure as `failed to resolve reference "<ref>": <cause>`, so this frame
// is the one marker that appears in cases belonging to two different categories. What is asserted here
// is the ORDER, not the marker: the three outputs below were captured from one daemon minutes apart and
// differ only after the colon, so a marker list that read the frame before the transport causes would
// pass the first of these and fail the other two - reporting a ploaness packaging defect to a team whose
// network was down.
describe('classifyImageFailure, the reference-resolution frame', (): void => {
  it('namesAPinnedDigestTheRegistryCannotServe', (): void => {
    const reference: string = 'docker.io/zricethezav/gitleaks@sha256:0000'
    expect(
      kindOf(
        classifyImageFailure(GATE, {
          code: 1,
          output: `${RESOLVE}"${reference}": ${reference}: not found`,
        }),
      ),
    ).toBe('manifestUnknown')
  })

  it('namesARefusedRegistryConnectionRatherThanTheReferenceItFailedToResolve', (): void => {
    expect(
      kindOf(
        classifyImageFailure(GATE, {
          code: 1,
          output:
            `${RESOLVE}"127.0.0.1:1/x:v1": failed to do request: ` +
            'Head "https://127.0.0.1:1/v2/x/manifests/v1": dial tcp 127.0.0.1:1: connect: connection refused',
        }),
      ),
    ).toBe('unreachable')
  })

  it('namesAnUnresolvableRegistryHostRatherThanTheReferenceItFailedToResolve', (): void => {
    expect(
      kindOf(
        classifyImageFailure(GATE, {
          code: 1,
          output:
            `${RESOLVE}"registry.invalid/x:v1": failed to do request: ` +
            'Head "https://registry.invalid/v2/x/manifests/v1": dial tcp: lookup registry.invalid on 192.168.5.1:53: no such host',
        }),
      ),
    ).toBe('unreachable')
  })
})

describe('classifyImageFailure, beyond the network causes', (): void => {
  it('namesADigestTheRegistryNoLongerServesAsAPloanessDefect', (): void => {
    const failure: DockerFailure | undefined = classifyImageFailure(GATE, {
      code: 1,
      output: 'Error response from daemon: manifest unknown',
    })
    expect(kindOf(failure)).toBe('manifestUnknown')
    expect(failure?.remedies.join(' ')).toContain('ploaness packaging defect')
  })

  it('fallsBackToUnstartableForAnUnrecognisedDockerError', (): void => {
    expect(kindOf(classifyImageFailure(GATE, { code: 1, output: 'something new' }))).toBe(
      'unstartable',
    )
  })

  it('opensTheSummaryWithTheGateThatFailed', (): void => {
    expect(
      classifyImageFailure('the workflow gate', { code: 1, output: 'toomanyrequests' })?.summary,
    ).toMatch(/^the workflow gate /)
  })
})

describe('classifyContainerExit', (): void => {
  // gitleaks answers 1 when it finds a secret, and that is the verdict the gate must report. Reading the
  // output for a Docker marker would let a commit message titled "fix: no such host" decide otherwise,
  // which is the same defect one level deeper.
  it('reportsNoFailureForAGitleaksFinding', (): void => {
    expect(
      classifyContainerExit(GATE, {
        code: 1,
        output:
          'Finding: AWS_SECRET=REDACTED\nCommit: 1a2b3c\nMessage: fix: retry when the registry says no such host\nFile: src/config.ts',
      }),
    ).toBeUndefined()
  })

  it('reportsNoFailureForACleanRun', (): void => {
    expect(classifyContainerExit(GATE, { code: 0, output: '' })).toBeUndefined()
  })

  // 125 is the code `docker run` reserves for a failure of its own, distinct from anything the container
  // exits with. No analyzer this harness runs emits it.
  it('namesADockerRunThatNeverStartedTheContainer', (): void => {
    expect(
      kindOf(
        classifyContainerExit(GATE, {
          code: 125,
          output: 'docker: Error response from daemon: invalid mount config',
        }),
      ),
    ).toBe('unstartable')
  })

  it('namesAnAbsentDockerBinaryFromTheShellsExitCode', (): void => {
    expect(
      kindOf(
        classifyContainerExit(GATE, { code: COMMAND_NOT_FOUND, output: 'sh: docker: not found' }),
      ),
    ).toBe('absent')
  })
})
