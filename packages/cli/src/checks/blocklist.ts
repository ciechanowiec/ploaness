// The gate that refuses named software: the shell around `blocklist.ts` in governance, holding the
// file reads, the compose render, and the pnpm inventory, and nothing that decides.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  type ComposeImage,
  type ComposeProject,
  composeProjectsIn,
  describeRefusal,
  dockerfilesIn,
  hasUnresolvedVariable,
  type InstalledPackage,
  imageReferencesInComposeModel,
  imageReferencesInDockerfile,
  imageReferencesInWorkflow,
  isMutableImageReference,
  packagesInLicenseInventory,
  type Refusal,
  refuseImage,
  refuseInstalledPackages,
  refuseSystemPackages,
  workflowsIn,
} from '@ploaness/governance'
import { type Context, workingTreeFiles } from '../context.js'
import { failed, type GateResult, passed, type RunResult, run } from '../exec.js'

const INVENTORY_LOCATION: string = 'the resolved dependency set'

// Every reference is judged three ways, in the order a reader repairs them: a refused image is replaced
// before its tag is pinned, and a reference nobody can resolve is named as such rather than passed.
const judgeReference = (location: string, reference: string): readonly string[] => {
  if (hasUnresolvedVariable(reference)) {
    return [
      `${location}: ${reference} carries a variable nothing substituted, so it cannot be judged; write it literally`,
    ]
  }
  const refusal: Refusal | undefined = refuseImage(reference)
  if (refusal !== undefined) {
    return [describeRefusal(refusal, location)]
  }
  return isMutableImageReference(reference)
    ? [
        `${location}: ${reference} is not pinned to a tag, so what it pulls can change without the repository changing`,
      ]
    : []
}

const readTracked = (context: Context, file: string): string =>
  readFileSync(path.join(context.root, file), 'utf8')

const judgeDockerfile = (context: Context, file: string): readonly string[] => {
  const text: string = readTracked(context, file)
  return [
    ...imageReferencesInDockerfile(text).flatMap((reference: string): readonly string[] =>
      judgeReference(file, reference),
    ),
    ...refuseSystemPackages(text).map((refusal: Refusal): string => describeRefusal(refusal, file)),
  ]
}

const judgeWorkflow = (context: Context, file: string): readonly string[] =>
  imageReferencesInWorkflow(readTracked(context, file)).flatMap(
    (reference: string): readonly string[] => judgeReference(file, reference),
  )

// Rendered rather than read: compose interpolates from the `.env` beside the file and merges its
// override files, and only the rendered model says what the daemon pulls. Run from the project's own
// directory for the reason `containers.ts` records. Both spellings of compose are tried, and a model
// that cannot be rendered fails the gate: an image nothing could read is not an image nobody pulls.
const renderCompose = (directory: string): RunResult => {
  const modern: RunResult = run('docker', ['compose', 'config', '--format', 'json'], {
    cwd: directory,
  })
  return modern.code === 0
    ? modern
    : run('docker-compose', ['config', '--format', 'json'], { cwd: directory })
}

interface ComposeJudgement {
  readonly findings: readonly string[]
  readonly unrendered: readonly string[]
}

const judgeComposeProject = (context: Context, project: ComposeProject): ComposeJudgement => {
  const rendered: RunResult = renderCompose(path.join(context.root, project.directory))
  const images: readonly ComposeImage[] | undefined =
    rendered.code === 0 ? imageReferencesInComposeModel(rendered.stdout) : undefined
  if (images === undefined) {
    return { findings: [], unrendered: [`${project.file}:`, rendered.output] }
  }
  return {
    findings: images.flatMap((entry: ComposeImage): readonly string[] =>
      judgeReference(`${project.file} (service ${entry.service})`, entry.image),
    ),
    unrendered: [],
  }
}

interface InventoryJudgement {
  readonly findings: readonly string[]
  readonly unread: readonly string[]
  readonly counted: number
}

const judgeInventory = (context: Context): InventoryJudgement => {
  const result: RunResult = run('pnpm', ['licenses', 'list', '--json'], { cwd: context.root })
  // Parsed from stdout alone, for the reason `dependencies.ts` records: pnpm writes its warnings to
  // stderr, and the joined output is not JSON.
  const packages: readonly InstalledPackage[] | undefined =
    result.code === 0 ? packagesInLicenseInventory(result.stdout) : undefined
  if (packages === undefined) {
    return { findings: [], unread: [result.output], counted: 0 }
  }
  return {
    findings: refuseInstalledPackages(packages).map((refusal: Refusal): string =>
      describeRefusal(refusal, INVENTORY_LOCATION),
    ),
    unread: [],
    counted: packages.length,
  }
}

const describeTargets = (
  dockerfiles: number,
  workflows: number,
  projects: number,
  packages: number,
): string =>
  `${String(dockerfiles)} Dockerfile(s), ${String(workflows)} workflow(s), ${String(projects)} compose ` +
  `project(s) and ${String(packages)} installed package(s) name nothing ploaness refuses`

/**
 * Fail when a container image, a Dockerfile system package, or an installed npm package is one
 * ploaness refuses, or when an image reference is not pinned to a tag.
 */
export const blocklist = (context: Context): GateResult => {
  const tracked: readonly string[] = workingTreeFiles(context.root)
  const dockerfiles: readonly string[] = dockerfilesIn(tracked)
  const workflows: readonly string[] = workflowsIn(tracked)
  const projects: readonly ComposeProject[] = composeProjectsIn(tracked)
  const compose: readonly ComposeJudgement[] = projects.map(
    (project: ComposeProject): ComposeJudgement => judgeComposeProject(context, project),
  )
  const inventory: InventoryJudgement = judgeInventory(context)
  const unreadable: readonly string[] = [
    ...compose.flatMap((judgement: ComposeJudgement): readonly string[] => judgement.unrendered),
    ...inventory.unread,
  ]
  if (unreadable.length > 0) {
    return failed('a compose model or the dependency inventory could not be read', [
      ...unreadable,
      'this gate is fail-closed by design; an image or package nothing could read is not one nobody uses',
    ])
  }
  const findings: readonly string[] = [
    ...dockerfiles.flatMap((file: string): readonly string[] => judgeDockerfile(context, file)),
    ...workflows.flatMap((file: string): readonly string[] => judgeWorkflow(context, file)),
    ...compose.flatMap((judgement: ComposeJudgement): readonly string[] => judgement.findings),
    ...inventory.findings,
  ]
  return findings.length > 0
    ? failed('software ploaness refuses is in use', findings)
    : passed(
        describeTargets(dockerfiles.length, workflows.length, projects.length, inventory.counted),
      )
}
