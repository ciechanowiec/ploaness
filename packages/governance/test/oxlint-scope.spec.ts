import { describe, expect, it } from 'vitest'
import { oxlintConfig, oxlintRuleNames, oxlintRules } from '../src/oxlint-policy.js'
import { type OxlintGroup, oxlintGroups, oxlintSourceFiles } from '../src/oxlint-scope.js'

describe('native source coverage', () => {
  it('includes authored hidden tooling, all JS/TS variants and unconventional paths once', () => {
    const files: readonly string[] = [
      '.storybook/preview.tsx',
      'tools/run.cjs',
      'tools/run.mjs',
      'tools/run.cts',
      'tools/run.mts',
      'widgets/card.jsx',
      'scripts/run.js',
      'src/[route]/with spaces.ts',
    ]
    expect(oxlintSourceFiles([...files, ...files, 'page.html'], [], [])).toEqual(files)
  })

  it('excludes declarations, generated output and siblings without hiding authored framework glue', () => {
    const excluded: readonly string[] = [
      'src/types.d.ts',
      'src/types.d.mts',
      'src/types.d.cts',
      'node_modules/lib/main.ts',
      '.next/types/main.ts',
      'dist/main.js',
      'build/main.js',
      'out/main.js',
      'coverage/main.js',
      'pgadmin/main.js',
      'src/payload-types.ts',
      'src/payload-generated-schema.ts',
      'src/app/(payload)/admin/importMap.js',
      'src/generated/api.ts',
      'cms/src/main.ts',
    ]
    expect(oxlintSourceFiles([...excluded, 'src/app/(payload)/layout.tsx'], ['src/generated/**'], ['cms'])).toEqual([
      'src/app/(payload)/layout.tsx',
    ])
  })

  it('partitions application source into disjoint three-rule and 34-rule groups', () => {
    const files: readonly string[] = ['src/main.ts', 'src/Card.tsx', '.storybook/preview.tsx']
    const groups: readonly OxlintGroup[] = oxlintGroups(files, true)
    expect(groups.map((group) => group.files)).toEqual([['src/main.ts', '.storybook/preview.tsx'], ['src/Card.tsx']])
    expect(groups.map((group) => group.rules.length)).toEqual([3, 34])
    expect(groups.flatMap((group) => group.files).toSorted((left, right) => left.localeCompare(right))).toEqual(
      files.toSorted((left, right) => left.localeCompare(right)),
    )
  })

  it('keeps library accessibility with Biome while adding core coverage', () => {
    const groups: readonly OxlintGroup[] = oxlintGroups(['src/Card.tsx'], false)
    expect(groups.map((group) => group.files)).toEqual([['src/Card.tsx']])
    expect(groups.map((group) => group.rules.length)).toEqual([3])
  })

  it('omits empty invocations', () => {
    expect(oxlintGroups([], true)).toEqual([])
    expect(oxlintGroups(['src/Card.tsx'], true).map((group) => group.rules.length)).toEqual([34])
  })

  it('keeps every native check on Payload admin scaffolds while accepting their upstream filenames', () => {
    const scaffold: string = 'src/app/(payload)/admin/[[...segments]]/page.tsx'
    const neighbor: string = 'src/app/(payload)/admin/[[...segments]]/helpers.tsx'
    const groups: readonly OxlintGroup[] = oxlintGroups([scaffold, neighbor, 'src/main.ts'], true, true)
    expect(groups.map((group) => group.files)).toEqual([['src/main.ts'], [neighbor], [scaffold]])
    expect(groups.map((group) => group.rules.length)).toEqual([3, 34, 34])
    expect(groups.map((group) => oxlintConfig(group.rules)['rules'])).toEqual([
      expect.objectContaining({
        'react/jsx-filename-extension': ['error', expect.objectContaining({ allow: 'as-needed' })],
      }),
      expect.objectContaining({
        'react/jsx-filename-extension': ['error', expect.objectContaining({ allow: 'as-needed' })],
      }),
      expect.objectContaining({
        'react/jsx-filename-extension': ['error', expect.objectContaining({ allow: 'always' })],
        'eslint/no-promise-executor-return': ['error', { allowVoid: false }],
        'jsx-a11y/alt-text': 'error',
      }),
    ])
  })

  it.each([true, false])('does not grant the scaffold exception to a non-Payload member with runtime %s', (runtime) => {
    const scaffold: string = 'src/app/(payload)/admin/[[...segments]]/not-found.tsx'
    const groups: readonly OxlintGroup[] = oxlintGroups([scaffold], runtime)
    expect(groups).toHaveLength(1)
    expect(oxlintConfig(groups[0]?.rules ?? [])['rules']).toHaveProperty('react/jsx-filename-extension', [
      'error',
      { allow: 'as-needed', extensions: ['.tsx', '.jsx'], ignoreFilesWithoutCode: false },
    ])
  })
})

describe('explicit native ownership', () => {
  it('enables only the validated core semantics', () => {
    expect(oxlintRuleNames(oxlintRules(false))).toEqual([
      'eslint/no-promise-executor-return',
      'import/no-absolute-path',
      'react/jsx-filename-extension',
    ])
    expect(oxlintConfig(oxlintRules(false))).toEqual({
      plugins: ['import', 'jsx-a11y', 'react'],
      categories: { correctness: 'off' },
      rules: {
        'eslint/no-promise-executor-return': ['error', { allowVoid: false }],
        'import/no-absolute-path': ['error', { esmodule: true, commonjs: false, amd: false }],
        'react/jsx-filename-extension': [
          'error',
          { allow: 'as-needed', extensions: ['.tsx', '.jsx'], ignoreFilesWithoutCode: false },
        ],
      },
    })
  })

  it('preserves the existing JSX semantic options beside the core rules', () => {
    const config: Readonly<Record<string, unknown>> = oxlintConfig(oxlintRules(true))
    expect(config['rules']).toHaveProperty('jsx-a11y/no-redundant-roles', ['error', { td: ['gridcell'] }])
    expect(Object.keys(config['rules'] as Record<string, unknown>)).toHaveLength(34)
  })
})
