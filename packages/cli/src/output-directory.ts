import { existsSync, mkdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git, type Repository } from './context.js'
import { type RunResult, run } from './exec.js'

// Resolve existing ancestors so an ignored symlink cannot direct output into authored content.
const resolvedDestination = (directory: string): string =>
  existsSync(directory)
    ? realpathSync(directory)
    : path.join(resolvedDestination(path.dirname(directory)), path.basename(directory))

/** What a writer produces, and how its refusal names it. */
export interface GeneratedOutput {
  readonly files: readonly string[]
  readonly label: string
}

/**
 * Resolve where generated reports may be written: outside the repository, or inside it only where Git
 * ignores every file the writer produces and tracks nothing.
 * @param repository the repository the reports describe.
 * @param requested the directory the caller asked for.
 * @param output the files the writer will publish there, including their temporary names.
 * @returns the resolved directory.
 */
export const ignoredOutputDirectory = (repository: Repository, requested: string, output: GeneratedOutput): string => {
  const directory: string = resolvedDestination(path.resolve(requested))
  const relative: string = path.relative(realpathSync(repository.root), directory)
  const isInside: boolean =
    relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  if (isInside) {
    const ignored: readonly RunResult[] = output.files.map(
      (file: string): RunResult =>
        run('git', ['check-ignore', '--quiet', '--', path.join(directory, file)], {
          cwd: repository.root,
        }),
    )
    const tracked: string = git(repository, ['ls-files', '--', relative])
    if (ignored.some((result: RunResult): boolean => result.code !== 0) || tracked.length > 0) {
      throw new Error(`${output.label} output must be in an ignored artifact directory or outside the repository`)
    }
  }
  return directory
}

/**
 * Publish each file through an exclusive temporary name and a rename, so a reader never sees a partial
 * report and a leftover temporary file is an error rather than something silently overwritten.
 * @param directory the resolved output directory.
 * @param files the file contents by name.
 */
export const publishFiles = (directory: string, files: Readonly<Record<string, string | Uint8Array>>): void => {
  mkdirSync(directory, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    const temporary: string = path.join(directory, `${name}.tmp`)
    writeFileSync(temporary, content, { flag: 'wx' })
    renameSync(temporary, path.join(directory, name))
  }
}
