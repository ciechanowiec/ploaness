// A bounded filesystem view for the working-tree half of the secret scan.
//
// Gitleaks directory mode has no Git awareness. Pointed at the repository itself it reads dependencies,
// build output, and ignored local environments - files the repository neither tracks nor governs. The
// caller supplies Git's own working-tree enumeration instead, and this module preserves only those
// regular text files under their repository-relative paths.
import { lstatSync, mkdirSync, readFileSync, type Stats, writeFileSync } from 'node:fs'
import path from 'node:path'

const NUL: number = 0

const isContainedRelativePath = (candidate: string): boolean => {
  const normalized: string = path.normalize(candidate)
  return (
    !path.isAbsolute(normalized) && normalized !== '..' && !normalized.startsWith(`..${path.sep}`)
  )
}

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { readonly code?: unknown }).code === 'ENOENT'

const readExistingFile = (target: string): Uint8Array | undefined => {
  const stat: Stats | undefined = lstatSync(target, { throwIfNoEntry: false })
  if (stat?.isFile() !== true) {
    return undefined
  }
  try {
    return readFileSync(target)
  } catch (error: unknown) {
    if (isMissing(error)) {
      return undefined
    }
    throw error
  }
}

const isText = (content: Uint8Array): boolean => !content.includes(NUL)

const mirrorOne = (root: string, destination: string, candidate: string): string | undefined => {
  if (!isContainedRelativePath(candidate)) {
    return undefined
  }
  const content: Uint8Array | undefined = readExistingFile(path.join(root, candidate))
  if (content === undefined || !isText(content)) {
    return undefined
  }
  const output: string = path.join(destination, candidate)
  mkdirSync(path.dirname(output), { recursive: true })
  writeFileSync(output, content)
  return candidate
}

/** Mirror regular non-binary working-tree candidates, retaining repository-relative paths. */
export const mirrorSecretCandidates = (
  root: string,
  destination: string,
  candidates: readonly string[],
): readonly string[] =>
  candidates
    .map((candidate: string): string | undefined => mirrorOne(root, destination, candidate))
    .filter((candidate: string | undefined): candidate is string => candidate !== undefined)
