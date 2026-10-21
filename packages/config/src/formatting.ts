import { fileURLToPath } from 'node:url'

/** Resolve the formatter from the package that owns its exact dependency version. */
export const prettierExecutable = (): string => fileURLToPath(import.meta.resolve('prettier/bin/prettier.cjs'))
