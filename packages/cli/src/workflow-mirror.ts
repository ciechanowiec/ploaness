import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  type Stats,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const mirrorFile = (root: string, destination: string, candidate: string): void => {
  const relative: string = path.normalize(candidate)
  if (relative === '..' || path.isAbsolute(relative) || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Workflow input is outside the repository: ${candidate}`)
  }
  const source: string = path.join(root, relative)
  const stat: Stats | undefined = lstatSync(source, { throwIfNoEntry: false })
  if (stat === undefined || stat.isDirectory()) {
    return
  }
  const target: string = path.join(destination, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  if (stat.isSymbolicLink()) {
    symlinkSync(readlinkSync(source), target)
  } else if (stat.isFile()) {
    writeFileSync(target, readFileSync(source))
  } else {
    throw new Error(`Workflow input is not a regular file or symbolic link: ${candidate}`)
  }
}

/** Give actionlint a disposable, Docker-readable view of the governed working tree. */
export const withWorkflowMirror = <Value>(
  root: string,
  candidates: readonly string[],
  use: (mirror: string) => Value,
): Value => {
  // Docker on macOS may not read Downloads or the system temporary directory. Mount an inner
  // directory under home; the private outer directory stays outside the container's filesystem.
  const directory: string = mkdtempSync(path.join(homedir(), '.ploaness-actions-'))
  const mirror: string = path.join(directory, 'repo')
  try {
    mkdirSync(path.join(mirror, '.github', 'workflows'), { recursive: true })
    // actionlint uses this marker to retain local-action and reusable-workflow validation. It
    // does not read Git history. All governed files retain their paths, including action entrypoints.
    mkdirSync(path.join(mirror, '.git'))
    for (const candidate of candidates) {
      mirrorFile(root, mirror, candidate)
    }
    return use(mirror)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
