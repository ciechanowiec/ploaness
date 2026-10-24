// What a change is, read from Git, and what it reaches, read from the import graph, handed to the scope
// policy in governance. Nothing here decides anything: which baseline counts, which file is global and
// which page a module reaches are `sweepScopeOf`'s, measured by its own specs.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  asRecord,
  type Baseline,
  baselineRemote,
  type ChangedFile,
  changeBaseline,
  declaredDependencies,
  ROOT_MEMBER_PATH,
  type SweepScope,
  sweepScopeOf,
  trackingBranch,
} from '@ploaness/governance'
import { importGraph } from './checks/toolchain.js'
import { type Member, type Repository, workingTreeFiles } from './context.js'
import { failed, type GateResult, type RunResult, run } from './exec.js'
import { untrackedWorkingTreeFiles } from './working-tree.js'

// Git's answer, or undefined when it has none: a missing ref and a failed merge-base are facts the
// policy names, not errors.
const gitAnswer = (root: string, commandArguments: readonly string[]): string | undefined => {
  const result: RunResult = run('git', commandArguments, { cwd: root })
  const answer: string = result.stdout.trim()
  return result.code === 0 && answer.length > 0 ? answer : undefined
}

const remoteHead = (root: string, remote: string): string | undefined =>
  gitAnswer(root, ['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`])

const existingBranch = (root: string, branch: string): string | undefined =>
  gitAnswer(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/${branch}`]) === undefined ? undefined : branch

const baselineOf = (root: string): Baseline => {
  const remote: string | undefined = baselineRemote((gitAnswer(root, ['remote']) ?? '').split('\n'))
  const branch: string | undefined =
    remote === undefined || remote === ''
      ? undefined
      : existingBranch(root, trackingBranch(remote, remoteHead(root, remote)))
  return changeBaseline({
    branch,
    isShallow: gitAnswer(root, ['rev-parse', '--is-shallow-repository']) === 'true',
    mergeBase: branch === undefined ? undefined : gitAnswer(root, ['merge-base', 'HEAD', `refs/remotes/${branch}`]),
  })
}

const DELETED: string = 'D'

// `--name-status -z` writes a status and a path per file, each ended by a NUL.
const FIELDS_PER_FILE: number = 2

const statusEntries = (fields: readonly string[]): readonly ChangedFile[] =>
  Array.from({ length: Math.floor(fields.length / FIELDS_PER_FILE) }, (_unused: unknown, index: number) => ({
    path: fields[index * FIELDS_PER_FILE + 1] ?? '',
    isDeleted: fields[index * FIELDS_PER_FILE] === DELETED,
  }))

// `git diff <commit>` compares the commit with the working tree, so it holds every commit since the
// baseline and every staged and unstaged edit at once; renames are split into a deletion and an
// addition, so both paths count. `--relative` reports paths from the repository root, as the untracked
// listing does, even where that root sits below Git's own.
const changedSince = (root: string, baseline: string): readonly ChangedFile[] | GateResult => {
  const result: RunResult = run('git', ['diff', '--name-status', '--no-renames', '--relative', '-z', baseline, '--'], {
    cwd: root,
  })
  if (result.code !== 0) {
    return failed('the change since the baseline could not be read', [result.output])
  }
  return [
    ...statusEntries(result.stdout.split('\0').filter((field: string): boolean => field !== '')),
    ...untrackedWorkingTreeFiles(root).map((file: string): ChangedFile => ({ path: file, isDeleted: false })),
  ]
}

const repositoryPath = (member: Member, relative: string): string =>
  path.posix.normalize(member.path === ROOT_MEMBER_PATH ? relative : `${member.path}/${relative}`)

// The members whose change reaches this application without an import: each it starts as an auxiliary
// server from that member's directory, and each it declares as a dependency.
const relatedMembers = (repository: Repository, member: Member): readonly string[] => {
  const serverDirectories: ReadonlySet<string> = new Set<string>(
    member.settings.auxiliaryServers.flatMap((server): readonly string[] =>
      server.cwd === undefined ? [] : [repositoryPath(member, server.cwd)],
    ),
  )
  const dependencies: ReadonlySet<string> = new Set<string>(Object.keys(declaredDependencies(member.packageJson)))
  return repository.members
    .filter((other: Member): boolean => other.path !== member.path)
    .filter((other: Member): boolean => {
      const name: unknown = asRecord(other.packageJson)['name']
      return serverDirectories.has(other.path) || (typeof name === 'string' && dependencies.has(name))
    })
    .map((other: Member): string => other.path)
}

const isFailure = (value: object): value is GateResult => 'ok' in value && value.ok === false

/**
 * The scope a `delta` run hands one application's browser sweep.
 * @param repository the repository, whose other members a change may reach this one through.
 * @param member the application.
 * @returns the scope, or the failure that kept it from being read.
 */
export const sweepScopeFor = (repository: Repository, member: Member): SweepScope | GateResult => {
  const baseline: Baseline = baselineOf(repository.root)
  if (baseline.commit === undefined) {
    return sweepScopeOf({
      baseline,
      changed: [],
      member: member.path,
      sourceRoots: member.settings.sourceRoots,
      members: [],
      related: [],
      files: [],
      graph: {},
    })
  }
  const changed: readonly ChangedFile[] | GateResult = changedSince(repository.root, baseline.commit)
  if (isFailure(changed)) {
    return changed
  }
  const graph: Readonly<Record<string, readonly string[]>> | GateResult = importGraph(member)
  if (isFailure(graph)) {
    return graph
  }
  return sweepScopeOf({
    baseline,
    changed,
    member: member.path,
    sourceRoots: member.settings.sourceRoots,
    members: repository.members.map((other: Member): string => other.path),
    related: relatedMembers(repository, member),
    files: workingTreeFiles(member.root),
    graph,
  })
}

/**
 * Whether a scope could not be read.
 * @param scope what `sweepScopeFor` answered.
 * @returns true for the failure.
 */
export const isScopeFailure = (scope: SweepScope | GateResult): scope is GateResult => isFailure(scope)

/**
 * Write a scope where the browser sweep reads it for the length of one run, outside the working tree.
 * @param scope the scope.
 * @param use what runs while the file exists.
 * @returns what `use` returned.
 */
export const withScopeFile = async <Result>(
  scope: SweepScope,
  use: (file: string) => Promise<Result>,
): Promise<Result> => {
  const directory: string = mkdtempSync(path.join(tmpdir(), 'ploaness-scope-'))
  const file: string = path.join(directory, 'scope.json')
  writeFileSync(file, `${JSON.stringify(scope)}\n`)
  try {
    return await use(file)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
