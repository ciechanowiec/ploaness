import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readlinkSync } from 'node:fs'
import path from 'node:path'

const BYTES_PER_KIB: number = 1024
const KIB_PER_MIB: number = 1024
const MAX_OUTPUT_MIB: number = 64

/** Enumerate tracked and non-ignored untracked paths on each call, including indexed deletions. */
export const workingTreeFiles = (root: string): readonly string[] =>
  [
    ...new Set(
      execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: MAX_OUTPUT_MIB * KIB_PER_MIB * BYTES_PER_KIB,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
        .split('\0')
        .filter((file: string): boolean => file !== ''),
    ),
  ].toSorted((left: string, right: string): number => left.localeCompare(right, 'en'))

const fileState = (root: string, file: string): readonly (string | number)[] => {
  const full: string = path.join(root, file)
  const stat: ReturnType<typeof lstatSync> | undefined = lstatSync(full, { throwIfNoEntry: false })
  if (stat === undefined) {
    return [file, 'absent']
  }
  if (stat.isSymbolicLink()) {
    return [file, 'symlink', readlinkSync(full)]
  }
  return stat.isFile()
    ? [file, 'file', stat.mode, createHash('sha256').update(readFileSync(full)).digest('hex')]
    : [file, 'directory']
}

/** Fingerprint paths, file kinds, modes, and bytes without following symbolic links. */
export const workingTreeFingerprint = (root: string): string =>
  createHash('sha256')
    .update(
      JSON.stringify(
        workingTreeFiles(root).map((file: string): readonly (string | number)[] =>
          fileState(root, file),
        ),
      ),
    )
    .digest('hex')
