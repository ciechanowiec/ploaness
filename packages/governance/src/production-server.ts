import { asRecord, readKey } from './json-shapes.js'

/** Next build metadata sufficient to choose the supported production launcher. */
export interface ProductionOutput {
  readonly standalone: boolean
  readonly relativeAppDir: string
  readonly distDir: string
}

/** A shell argument quoted without expanding shell variables or command substitutions. */
export const shellArgument = (value: string): string => `'${value.replaceAll("'", "'\"'\"'")}'`

/** Select the server from the artifact's recorded configuration, never a development fallback. */
export const productionOutputOf = (manifest: unknown): ProductionOutput => {
  const config: Record<string, unknown> = asRecord(readKey(manifest, 'config'))
  const output: unknown = config['output']
  const appDirectory: unknown = readKey(manifest, 'relativeAppDir')
  const buildDirectory: unknown = config['distDir']
  if (
    typeof buildDirectory !== 'string' ||
    typeof appDirectory !== 'string' ||
    (output !== undefined && output !== 'standalone')
  ) {
    throw new TypeError('production browser verification requires ordinary or standalone Next server output')
  }
  return { standalone: output === 'standalone', relativeAppDir: appDirectory, distDir: buildDirectory }
}

/** Identifies the production-directory probe's evidence among project configuration logs. */
export const PRODUCTION_DIRECTORY_MARKER: string = 'ploaness-production-directory:'

/** Parse exactly one complete directory report; malformed or ambiguous evidence cannot select output. */
export const parseProductionDirectory = (text: string): string | undefined => {
  const lines: readonly string[] = text
    .split('\n')
    .map((line: string): string => line.trim())
    .filter((line: string): boolean => line.startsWith(PRODUCTION_DIRECTORY_MARKER))
  if (lines.length !== 1) {
    return undefined
  }
  try {
    const value: unknown = JSON.parse((lines[0] ?? '').slice(PRODUCTION_DIRECTORY_MARKER.length))
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined
  } catch {
    return undefined
  }
}
