import { hasExtension, matchesGlob } from './file-roles.js'
import { GENERATED_ARTEFACTS, PAYLOAD_ADMIN_DIRECTORY } from './generated-denial.js'
import { jsxAccessibilityFiles } from './jsx-accessibility-scope.js'
import { type OxlintRule, oxlintRules } from './oxlint-policy.js'
import { analysisBoundaries } from './workspace-policy.js'

/** Authored JavaScript and TypeScript, including configuration and hidden tooling. */
export const OXLINT_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

const OUTPUTS: readonly string[] = [
  '**/node_modules/**',
  '.next/**',
  'dist/**',
  'build/**',
  'out/**',
  'coverage/**',
  'pgadmin/**',
]

/** Select committable source without giving generated output or siblings a second owner. */
export const oxlintSourceFiles = (
  files: readonly string[],
  generated: readonly string[],
  siblings: readonly string[],
): readonly string[] => {
  const ignored: readonly string[] = [...OUTPUTS, ...GENERATED_ARTEFACTS, ...generated, ...analysisBoundaries(siblings)]
  return [...new Set(files)].filter(
    (file: string): boolean =>
      hasExtension(file, OXLINT_EXTENSIONS) &&
      !/\.d\.(?:ts|mts|cts)$/u.test(file) &&
      !ignored.some((pattern: string): boolean => matchesGlob(pattern, file)),
  )
}

/** One native invocation, whose report must account for exactly these files and rules. */
export interface OxlintGroup {
  readonly files: readonly string[]
  readonly rules: readonly OxlintRule[]
}

// Payload generates these .tsx entry points as calls into its own renderer, without JSX syntax.
// Only their filename requirement differs; native correctness and accessibility still apply.
// An application may mount the same admin route without the optional route group.
const PAYLOAD_ADMIN_SCAFFOLDS: ReadonlySet<string> = new Set(
  [PAYLOAD_ADMIN_DIRECTORY, PAYLOAD_ADMIN_DIRECTORY.replaceAll(/\/\([^/]+\)/gu, '')].flatMap(
    (directory: string): readonly string[] =>
      ['page', 'not-found'].map((name: string): string => `${directory}/[[...segments]]/${name}.tsx`),
  ),
)

/** Partition source by analyzer ownership and the filenames the Payload scaffold requires. */
export const oxlintGroups = (
  files: readonly string[],
  hasAppRuntime: boolean,
  isPayload: boolean = false,
): readonly OxlintGroup[] => {
  const jsx: ReadonlySet<string> = new Set(hasAppRuntime ? jsxAccessibilityFiles(files, [], []) : [])
  const scaffolds: ReadonlySet<string> = new Set(
    files.filter((file: string): boolean => isPayload && jsx.has(file) && PAYLOAD_ADMIN_SCAFFOLDS.has(file)),
  )
  return [
    { files: files.filter((file: string): boolean => !jsx.has(file)), rules: oxlintRules(false) },
    {
      files: files.filter((file: string): boolean => jsx.has(file) && !scaffolds.has(file)),
      rules: oxlintRules(true),
    },
    { files: files.filter((file: string): boolean => scaffolds.has(file)), rules: oxlintRules(true, true) },
  ].filter((group: OxlintGroup): boolean => group.files.length > 0)
}
