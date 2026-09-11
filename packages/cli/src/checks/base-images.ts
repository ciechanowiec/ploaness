// The base images a project's Dockerfiles build on, scanned for the operating-system package
// vulnerabilities nothing else here reads.
//
// The analyzer pulls each image from its registry itself, and fetches its vulnerability database on
// every run: a cached database is never refused for being stale, so one would silently judge against
// last month's advisories. No repository is mounted, because an image scan needs none and the analyzer
// reads `trivy.yaml` and `.trivyignore` from wherever it runs - so it runs at `/`, and a committed
// configuration is refused before any scan. Trust follows the host's: the certificate authority an
// intercepting proxy needs, declared through NODE_EXTRA_CA_CERTS, is handed to the analyzer, and a
// certificate failure is reported as analysis that did not happen rather than as a clean image.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  type BaseImage,
  type BaseImageInventory,
  type BaseImageReport,
  baseImagesIn,
  CONTAINER_IMAGES,
  type DockerfileText,
  dockerfilesIn,
  type ImageScan,
  type JudgedScan,
  judgeImageScans,
  NETWORKED_TOOL_TIMEOUT_MS,
  readImageScan,
  trivyConfigsIn,
} from '@ploaness/governance'
import { type Context, workingTreeFiles } from '../context.js'
import {
  failed,
  type GateResult,
  passed,
  type RunResult,
  run,
  TIMED_OUT_CODE,
  withOutput,
} from '../exec.js'
import { acquireImage, dockerFault } from './container-run.js'

const TRIVY_IMAGE: string = CONTAINER_IMAGES.trivy
const BASE_IMAGE_GATE: string = 'the base image gate'

// The analyzer's own exit for a tool error is 1, the same as its default for findings. Naming two other
// codes makes the four outcomes distinguishable before the report is read: 0 clean, 2 findings, 3 an
// operating system past end of life, and anything else the analyzer stopping before it decided.
const FINDINGS_EXIT: number = 2
const END_OF_LIFE_EXIT: number = 3
const REPORT_EXITS: ReadonlySet<number> = new Set([0, FINDINGS_EXIT, END_OF_LIFE_EXIT])

const MAX_REPORTED_LINES: number = 5
const CACHE_MOUNT: string = '/var/cache/trivy'
const CERTIFICATE_MOUNT: string = '/etc/ssl/ploaness-ca.pem'

interface Workspace {
  readonly cacheDirectory: string
  readonly certificateFile: string | undefined
}

// The bundle the host declares, and only that: a Go binary in a container cannot see the keychain a
// daemon trusts, so an intercepting proxy is invisible to it unless the host says where the authority
// is. NODE_EXTRA_CA_CERTS first, because Node ADDS that file to its roots and reads SSL_CERT_FILE as
// a replacement for them - so the first is the one a host can set to the proxy's authority alone
// without breaking every other tool in the same environment, and the one the guide asks for.
const declaredCertificateBundle = (): string | undefined => {
  const bundle: string | undefined =
    process.env['NODE_EXTRA_CA_CERTS'] ?? process.env['SSL_CERT_FILE']
  return bundle !== undefined && bundle.length > 0 && existsSync(bundle) ? bundle : undefined
}

// Rendered under the home directory for the reason the secrets gate records: a macOS Docker daemon
// shares the home directory and need not share /tmp, and an unshared source mounts as an empty
// directory rather than as an error. The bundle is COPIED in rather than mounted from where it lives,
// for the same reason. One cache serves every image in the run, so the database is fetched once.
const withWorkspace = <Value>(use: (workspace: Workspace) => Value): Value => {
  const directory: string = mkdtempSync(path.join(homedir(), '.ploaness-base-images-'))
  const cacheDirectory: string = path.join(directory, 'cache')
  try {
    mkdirSync(cacheDirectory)
    const bundle: string | undefined = declaredCertificateBundle()
    const certificateFile: string | undefined =
      bundle === undefined ? undefined : path.join(directory, 'ca.pem')
    if (bundle !== undefined && certificateFile !== undefined) {
      copyFileSync(bundle, certificateFile)
    }
    return use({ cacheDirectory, certificateFile })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

// The host's bundle is APPENDED to the analyzer's own roots rather than handed to it as SSL_CERT_FILE,
// which the analyzer would read as a replacement: a bundle holding only an intercepting proxy's
// authority - the shape NODE_EXTRA_CA_CERTS usually takes - would then fail every host the proxy does
// not intercept. The script is a constant; the analyzer's arguments reach it positionally through
// `"$@"` and are never interpolated into it, which is the discipline the other gates keep with argv.
const ANALYZER_ROOTS: string = '/etc/ssl/certs/ca-certificates.crt'
const MERGED_BUNDLE: string = `${CACHE_MOUNT}/ca.pem`
const TRUSTING_ENTRYPOINT: string =
  `cat ${ANALYZER_ROOTS} ${CERTIFICATE_MOUNT} > ${MERGED_BUNDLE} && ` +
  `SSL_CERT_FILE=${MERGED_BUNDLE} exec trivy "$@"`

const dockerArguments = (workspace: Workspace): readonly string[] => [
  'run',
  '--rm',
  '-v',
  `${workspace.cacheDirectory}:${CACHE_MOUNT}`,
  ...(workspace.certificateFile === undefined
    ? []
    : ['-v', `${workspace.certificateFile}:${CERTIFICATE_MOUNT}:ro`, '--entrypoint', 'sh']),
  '--workdir',
  '/',
  TRIVY_IMAGE,
  ...(workspace.certificateFile === undefined ? [] : ['-c', TRUSTING_ENTRYPOINT, 'sh']),
]

// Every policy flag is on the argv, so a configuration the analyzer somehow loaded could not override
// one. `--image-src remote` pulls from the registry alone rather than probing three daemons first.
const scanArguments = (workspace: Workspace, reference: string): readonly string[] => [
  ...dockerArguments(workspace),
  'image',
  '--image-src',
  'remote',
  '--scanners',
  'vuln',
  '--pkg-types',
  'os',
  '--severity',
  'HIGH,CRITICAL',
  '--ignore-unfixed',
  '--list-all-pkgs',
  '--exit-code',
  String(FINDINGS_EXIT),
  '--exit-on-eol',
  String(END_OF_LIFE_EXIT),
  '--format',
  'json',
  '--quiet',
  '--no-progress',
  '--cache-dir',
  CACHE_MOUNT,
  reference,
]

type Scanned = { readonly judged: JudgedScan } | { readonly fault: GateResult }

const capped = (output: string): string =>
  output.split('\n').slice(0, MAX_REPORTED_LINES).join('\n')

// The one line that turns a tool error into a repair, where the error's text says which. The verdict
// is already a fault; these change only what the reader is told to do.
const repairFor = (output: string): readonly string[] => {
  if (/x509|certificate signed by unknown authority/.test(output)) {
    return [
      'an intercepting proxy is in the path: export its certificate authority as a PEM file and set ' +
        'NODE_EXTRA_CA_CERTS to it in the environment of the verification command, never in the ' +
        'repository; the procedure is in the base-images section of .ploaness/agent-guide.md',
    ]
  }
  if (output.includes('toomanyrequests')) {
    return ["the registry's rate limit refused the pull; retry later"]
  }
  if (/unauthorized|\b401\b/i.test(output)) {
    return [
      'the registry requires credentials this gate does not carry; a base image must be pullable ' +
        'anonymously',
    ]
  }
  return []
}

const faultFor = (image: BaseImage, summary: string, lines: readonly string[]): GateResult =>
  failed(`${BASE_IMAGE_GATE} ${summary} for ${image.written}`, lines)

// What the analyzer's exit must be for the report it wrote, since the two are decided separately:
// end of life outranks findings, and findings outrank a clean run.
const expectedExit = (scan: ImageScan): number => {
  if (scan.os?.isEndOfLife === true) {
    return END_OF_LIFE_EXIT
  }
  return scan.vulnerabilities.length > 0 ? FINDINGS_EXIT : 0
}

const readScan = (image: BaseImage, result: RunResult): Scanned => {
  const scan: ImageScan | undefined = readImageScan(result.stdout)
  if (scan === undefined) {
    return {
      fault: faultFor(image, "could not read the analyzer's report", [capped(result.output)]),
    }
  }
  if (expectedExit(scan) !== result.code) {
    return {
      fault: faultFor(image, 'received an exit status that disagrees with the report', [
        `the analyzer exited ${String(result.code)} for a report that warrants ${String(expectedExit(scan))}`,
      ]),
    }
  }
  return { judged: { image, scan } }
}

const scanImage = (context: Context, workspace: Workspace, image: BaseImage): Scanned => {
  const result: RunResult = run('docker', scanArguments(workspace, image.scanReference), {
    cwd: context.root,
    timeoutMs: NETWORKED_TOOL_TIMEOUT_MS,
  })
  const docker: GateResult | undefined = dockerFault(context, TRIVY_IMAGE, BASE_IMAGE_GATE, result)
  if (docker !== undefined) {
    return { fault: docker }
  }
  if (result.code === TIMED_OUT_CODE) {
    return {
      fault: faultFor(image, 'did not hear back from its analyzer', [
        `the scan did not finish within ${String(NETWORKED_TOOL_TIMEOUT_MS)}ms and was stopped`,
      ]),
    }
  }
  if (!REPORT_EXITS.has(result.code)) {
    return {
      fault: faultFor(image, 'could not complete its analyzer run', [
        capped(result.output),
        ...repairFor(result.output),
      ]),
    }
  }
  return readScan(image, result)
}

interface Counts {
  readonly dockerfiles: number
  readonly images: number
}

const verdict = (
  staticFindings: readonly string[],
  report: BaseImageReport,
  counts: Counts,
): GateResult => {
  const findings: readonly string[] = [...staticFindings, ...report.findings, ...report.deadEntries]
  if (findings.length > 0) {
    return failed(`${String(findings.length)} base image finding(s)`, findings)
  }
  return passed(
    counts.images === 0
      ? `${String(counts.dockerfiles)} Dockerfile(s) build on no registry image, so there is nothing to scan`
      : `${String(counts.images)} base image(s) across ${String(counts.dockerfiles)} Dockerfile(s) ` +
          'carry no fixable HIGH or CRITICAL OS package vulnerability across ' +
          `${String(report.packageCount)} package(s)`,
  )
}

// The static findings already stand when the analyzer cannot be obtained or cannot run; they are
// reported beneath the fault rather than lost, the way the infrastructure gate keeps its pattern
// findings under a docker failure.
const withStaticFindings = (fault: GateResult, staticFindings: readonly string[]): GateResult =>
  staticFindings.length === 0
    ? fault
    : failed(fault.summary, [
        ...fault.findings,
        'the references below could be judged without the analyzer, and were:',
        ...staticFindings,
      ])

interface Progress {
  readonly judged: readonly JudgedScan[]
  readonly fault: GateResult | undefined
}

// Images are scanned one after another, and nothing is scanned once one has faulted: the fault is
// the verdict, and a second pull would only spend the registry's patience on a run already decided.
const scanEach = (context: Context, workspace: Workspace, images: readonly BaseImage[]): Progress =>
  images.reduce(
    (state: Progress, image: BaseImage): Progress => {
      if (state.fault !== undefined) {
        return state
      }
      const scanned: Scanned = scanImage(context, workspace, image)
      return 'fault' in scanned
        ? { ...state, fault: scanned.fault }
        : { ...state, judged: [...state.judged, scanned.judged] }
    },
    { judged: [], fault: undefined },
  )

const scanAll = (
  context: Context,
  workspace: Workspace,
  inventory: BaseImageInventory,
  counts: Counts,
): GateResult => {
  const progress: Progress = scanEach(context, workspace, inventory.images)
  if (progress.fault !== undefined) {
    return withStaticFindings(progress.fault, inventory.findings)
  }
  const report: BaseImageReport = judgeImageScans(
    progress.judged,
    context.settings.imageVulnerabilityAllowlist,
  )
  return withOutput(
    verdict(inventory.findings, report, counts),
    progress.judged.map((entry: JudgedScan): string => JSON.stringify(entry.scan)).join('\n'),
  )
}

/** Scan every base image the repository's Dockerfiles build on. */
export const baseImages = (context: Context): GateResult => {
  const tracked: readonly string[] = workingTreeFiles(context.root)
  const dockerfiles: readonly string[] = dockerfilesIn(tracked)
  // No Dockerfile means no container: a project that ships none never needs the image.
  if (dockerfiles.length === 0) {
    return passed('the project ships no Dockerfile')
  }
  const shadowing: readonly string[] = trivyConfigsIn(tracked)
  if (shadowing.length > 0) {
    return failed('a local analyzer configuration would shadow the base image rules', [
      ...shadowing.map((file: string): string => `${file} configures the analyzer this gate runs`),
      'delete it; imageVulnerabilityAllowlist in package.json is the only exception this gate honours',
    ])
  }
  const inventory: BaseImageInventory = baseImagesIn(
    dockerfiles.map(
      (file: string): DockerfileText => ({
        file,
        text: readFileSync(path.join(context.root, file), 'utf8'),
      }),
    ),
  )
  const counts: Counts = { dockerfiles: dockerfiles.length, images: inventory.images.length }
  // Nothing scannable means no container either: the static findings, or a tree built from scratch.
  if (inventory.images.length === 0) {
    return verdict(
      inventory.findings,
      judgeImageScans([], context.settings.imageVulnerabilityAllowlist),
      counts,
    )
  }
  const unavailable: GateResult | undefined = acquireImage(context, TRIVY_IMAGE, BASE_IMAGE_GATE)
  if (unavailable !== undefined) {
    return withStaticFindings(unavailable, inventory.findings)
  }
  return withWorkspace(
    (workspace: Workspace): GateResult => scanAll(context, workspace, inventory, counts),
  )
}
