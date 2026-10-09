import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  CONTAINER_IMAGES,
  canonicalInventory,
  parseSbomArguments,
  type ReleaseArtifact,
  readKey,
  SBOM_SCOPE,
  type SbomArguments,
  sbomInputProblems,
  sbomProblems,
  sbomWithWorkspaceRoles,
} from '@ploaness/governance'
import { parseAllDocuments } from 'yaml'
import { acquireImage } from '../checks/container-run.js'
import { git, type Repository } from '../context.js'
import { type GateResult, type RunResult, run } from '../exec.js'
import { workingTreeFingerprint } from '../working-tree.js'

const JSON_INDENT: number = 2
const SBOM_TIMEOUT_MS: number = 300_000
const IMAGE: string = CONTAINER_IMAGES.cdxgen

const hashFile = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'))

const lockDocument = (file: string): unknown => {
  const documents: ReturnType<typeof parseAllDocuments> = parseAllDocuments(readFileSync(file, 'utf8'))
  if (documents.length === 0 || documents.some((document) => document.errors.length > 0)) {
    throw new Error(`${file} is not a readable pnpm lockfile`)
  }
  return documents.at(-1)?.toJS()
}

const assertInputs = (repository: Repository): void => {
  const problems: readonly string[] = sbomInputProblems(
    repository.projects,
    lockDocument(path.join(repository.root, 'pnpm-lock.yaml')),
    lockDocument(path.join(repository.root, 'node_modules/.pnpm/lock.yaml')),
    existsSync(path.join(repository.root, 'pnpm-workspace.yaml'))
      ? lockDocument(path.join(repository.root, 'pnpm-workspace.yaml'))
      : {},
  )
  if (problems.length > 0) {
    throw new Error(problems.join('\n'))
  }
}

// Resolve existing ancestors so an ignored symlink cannot direct output into authored content.
const resolvedDestination = (directory: string): string =>
  existsSync(directory)
    ? realpathSync(directory)
    : path.join(resolvedDestination(path.dirname(directory)), path.basename(directory))

const outputDirectory = (repository: Repository, requested: string): string => {
  const directory: string = resolvedDestination(path.resolve(requested))
  const relative: string = path.relative(realpathSync(repository.root), directory)
  const isInside: boolean =
    relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  if (isInside) {
    const ignored: readonly RunResult[] = ['bom.cdx.json', 'release.json', 'bom.cdx.json.tmp', 'release.json.tmp'].map(
      (file: string): RunResult =>
        run('git', ['check-ignore', '--quiet', '--', path.join(directory, file)], {
          cwd: repository.root,
        }),
    )
    const tracked: string = git(repository, ['ls-files', '--', relative])
    if (ignored.some((result: RunResult): boolean => result.code !== 0) || tracked.length > 0) {
      throw new Error('SBOM output must be in an ignored artifact directory or outside the repository')
    }
  }
  return directory
}

const mirrorInputs = (repository: Repository, directory: string): void => {
  const files: readonly string[] = [
    ...new Set([
      'package.json',
      'pnpm-lock.yaml',
      ...(existsSync(path.join(repository.root, 'pnpm-workspace.yaml')) ? ['pnpm-workspace.yaml'] : []),
      ...repository.projects.map((project): string => path.join(project.path, 'package.json')),
    ]),
  ]
  for (const file of files) {
    const destination: string = path.join(directory, file)
    mkdirSync(path.dirname(destination), { recursive: true })
    copyFileSync(path.join(repository.root, file), destination)
  }
}

const generate = (repository: Repository, directory: string): unknown => {
  const input: string = path.join(directory, 'input')
  const output: string = path.join(directory, 'output')
  mkdirSync(input)
  mkdirSync(output)
  mirrorInputs(repository, input)
  const result: RunResult = run(
    'docker',
    [
      'run',
      '--rm',
      '--network=none',
      '-v',
      `${input}:/workspace:ro`,
      '-v',
      `${output}:/output`,
      '-w',
      '/workspace',
      '-e',
      'FETCH_LICENSE=false',
      '-e',
      'CDXGEN_FETCH_PKG_METADATA=false',
      IMAGE,
      '-t',
      'js',
      '--recurse',
      '--no-install-deps',
      '--no-babel',
      '--fail-on-error',
      '--validate',
      '--spec-version',
      '1.6',
      '-o',
      '/output/bom.cdx.json',
      '/workspace',
    ],
    { cwd: repository.root, timeoutMs: SBOM_TIMEOUT_MS },
  )
  if (result.code !== 0) {
    throw new Error(`SBOM generation failed: ${result.output}`)
  }
  const bom: unknown = readJson(path.join(output, 'bom.cdx.json'))
  const problems: readonly string[] = sbomProblems(bom)
  if (problems.length > 0) {
    throw new Error(problems.join('\n'))
  }
  return sbomWithWorkspaceRoles(bom, repository.projects)
}

const artifactsOf = (arguments_: SbomArguments): readonly ReleaseArtifact[] =>
  arguments_.artifacts.map((file: string) => {
    const absolute: string = realpathSync(path.resolve(file))
    if (!statSync(absolute).isFile()) {
      throw new Error(`release artifact is not a file: ${file}`)
    }
    return { path: path.basename(absolute), sha256: hashFile(absolute) }
  })

const rejectArtifactOutputs = (arguments_: SbomArguments, directory: string): void => {
  const outputs: ReadonlySet<string> = new Set(
    ['bom.cdx.json', 'release.json', 'bom.cdx.json.tmp', 'release.json.tmp'].map((file: string): string =>
      path.join(directory, file),
    ),
  )
  if (arguments_.artifacts.some((file: string): boolean => outputs.has(realpathSync(path.resolve(file))))) {
    throw new Error('release artifacts must not be overwritten by the SBOM output files')
  }
}

const publishReports = (directory: string, reports: Readonly<Record<string, unknown>>): void => {
  mkdirSync(directory, { recursive: true })
  for (const [name, report] of Object.entries(reports)) {
    const temporary: string = path.join(directory, `${name}.tmp`)
    writeFileSync(temporary, `${JSON.stringify(report, null, JSON_INDENT)}\n`, { flag: 'wx' })
    renameSync(temporary, path.join(directory, name))
  }
}

/** Produce a release-associated workspace inventory without changing the source or its installation. */
export const sbom = (repository: Repository, arguments_: readonly string[]): number => {
  const arguments__: SbomArguments | undefined = parseSbomArguments(arguments_)
  if (arguments__ === undefined) {
    throw new Error('usage: ploaness sbom --artifact <file> [--artifact <file> ...] [--output <directory>]')
  }
  const before: string = workingTreeFingerprint(repository.root)
  const destination: string = outputDirectory(repository, arguments__.output)
  rejectArtifactOutputs(arguments__, destination)
  const artifacts: readonly ReleaseArtifact[] = artifactsOf(arguments__)
  if (new Set(artifacts.map((artifact: ReleaseArtifact): string => artifact.path)).size !== artifacts.length) {
    throw new Error('release artifact filenames must be distinct')
  }
  assertInputs(repository)
  const unavailable: GateResult | undefined = acquireImage(repository, IMAGE, 'SBOM generation')
  if (unavailable !== undefined) {
    throw new Error([unavailable.summary, ...unavailable.findings].join('\n'))
  }
  const temporary: string = mkdtempSync(path.join(homedir(), '.ploaness-sbom-'))
  try {
    const bom: unknown = generate(repository, temporary)
    if (before !== workingTreeFingerprint(repository.root)) {
      throw new Error('the authored tree changed during SBOM generation; regenerate from stable inputs')
    }
    if (canonicalInventory(artifacts) !== canonicalInventory(artifactsOf(arguments__))) {
      throw new Error('release artifact bytes changed during SBOM generation')
    }
    const text: string = `${JSON.stringify(bom, null, JSON_INDENT)}\n`
    publishReports(destination, {
      'bom.cdx.json': bom,
      'release.json': {
        schemaVersion: 1,
        sourceCommit: git(repository, ['rev-parse', 'HEAD']).trim(),
        sourceDirty: git(repository, ['status', '--porcelain']).length > 0,
        sourceFingerprint: before,
        lockfileSha256: hashFile(path.join(repository.root, 'pnpm-lock.yaml')),
        generator: { image: IMAGE, tool: readKey(readKey(bom, 'metadata'), 'tools') },
        scope: SBOM_SCOPE,
        sbomSha256: createHash('sha256').update(text).digest('hex'),
        artifacts,
      },
    })
    console.info(`SBOM and release metadata written to ${destination}`)
    return 0
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
