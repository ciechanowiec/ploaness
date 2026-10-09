import { describe, expect, it } from 'vitest'
import {
  canonicalInventory,
  parseSbomArguments,
  type SbomManifest,
  sbomInputProblems,
  sbomProblems,
  sbomWithWorkspaceRoles,
} from '../src/sbom-policy.js'
import { type ReleaseEvidence, releaseInventoryProblems, SBOM_SCOPE } from '../src/sbom-release.js'

const component = (name: string): Record<string, unknown> => ({
  type: 'library',
  name,
  version: '1.0.0',
  'bom-ref': name,
  purl: `pkg:npm/${name}@1.0.0`,
})
const bom: Readonly<Record<string, unknown>> = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  metadata: { component: component('app') },
  components: [component('direct'), { ...component('shared'), components: [component('nested')] }],
  dependencies: [
    { ref: 'app', dependsOn: ['direct'] },
    { ref: 'direct', dependsOn: ['shared', 'nested'] },
    { ref: 'shared', dependsOn: [] },
    { ref: 'nested', dependsOn: [] },
  ],
  compositions: [{ aggregate: 'complete' }],
}

describe('SBOM command grammar', () => {
  it('collects artifacts and preserves a single explicit output directory', () => {
    expect(
      parseSbomArguments(['--artifact', 'one.tgz', '--artifact', 'two.tgz', '--output', 'dist/inventory']),
    ).toEqual({
      artifacts: ['one.tgz', 'two.tgz'],
      output: 'dist/inventory',
    })
    expect(parseSbomArguments(['--artifact', 'one.tgz'])).toEqual({ artifacts: ['one.tgz'], output: 'dist/sbom' })
  })
  it('refuses incomplete or ambiguous arguments', () => {
    const cases: readonly (readonly string[])[] = [
      [],
      ['--artifact'],
      ['--unknown', 'x'],
      ['--artifact', ''],
      ['--artifact', '--x'],
      ['--artifact', 'x', '--artifact', 'x'],
      ['--artifact', 'x', '--output', 'a', '--output', 'b'],
    ]
    for (const arguments_ of cases) {
      expect(parseSbomArguments(arguments_)).toBeUndefined()
    }
  })
})

describe('frozen SBOM inputs', () => {
  const manifest: SbomManifest = { path: '.', packageJson: { dependencies: { direct: '1.0.0' } } }
  const lock: Readonly<Record<string, unknown>> = {
    lockfileVersion: '9.0',
    importers: { '.': { dependencies: { direct: { specifier: '1.0.0', version: '1.0.0' } } } },
    packages: { 'direct@1.0.0': {} },
    snapshots: { 'direct@1.0.0': {} },
  }
  it('compares structure independently of property order', () => {
    expect(canonicalInventory({ beta: [1, null], alpha: undefined })).toBe(
      canonicalInventory({ alpha: null, beta: [1, null] }),
    )
    expect(sbomInputProblems([manifest], lock, lock)).toEqual([])
    expect(sbomInputProblems([manifest], { ...lock, lockfileVersion: 9 }, lock)).toEqual([])
  })
  it('rejects unsupported lockfiles, missing importers and inconsistent install snapshots', () => {
    expect(sbomInputProblems([manifest], undefined, lock)).toHaveLength(1)
    expect(sbomInputProblems([manifest], { ...lock, lockfileVersion: 6 }, lock)).toHaveLength(1)
    expect(sbomInputProblems([manifest], lock, {})).toEqual([expect.stringContaining('installed')])
    expect(sbomInputProblems([manifest], lock, undefined)).toEqual([expect.stringContaining('missing')])
    expect(sbomInputProblems([{ path: 'packages/missing', packageJson: {} }], lock, lock)).toEqual([
      expect.stringContaining('no importer'),
    ])
  })
  it('rejects manifests changed since the lockfile was resolved', () => {
    expect(
      sbomInputProblems(
        [{ ...manifest, packageJson: { dependencies: { direct: '1.0.0' }, devDependencies: { added: '2.0.0' } } }],
        lock,
        lock,
      ),
    ).toEqual([expect.stringContaining('added')])
  })
  it('rejects dependencies removed from the manifest but retained in the lockfile', () => {
    expect(sbomInputProblems([{ ...manifest, packageJson: {} }], lock, lock)).toEqual([
      expect.stringContaining('direct'),
    ])
    const overridden: Readonly<Record<string, unknown>> = { ...lock, overrides: { direct: '1.0.0' } }
    expect(
      sbomInputProblems([{ ...manifest, packageJson: {} }], overridden, overridden, {
        overrides: { direct: '1.0.0' },
      }),
    ).toEqual([expect.stringContaining('direct')])
  })
  it('accepts an explicit archive override and refuses an unrefreshed override declaration', () => {
    const archive: string = 'file:archives/direct.tgz'
    const overridden: Readonly<Record<string, unknown>> = {
      ...lock,
      overrides: { direct: archive },
      importers: { '.': { dependencies: { direct: { specifier: archive, version: archive } } } },
    }
    expect(sbomInputProblems([manifest], overridden, overridden, { overrides: { direct: archive } })).toEqual([])
    expect(sbomInputProblems([manifest], overridden, overridden, { overrides: { direct: '2.0.0' } })).toEqual([
      expect.stringContaining('overrides differ'),
    ])
    const scoped: Readonly<Record<string, unknown>> = { ...overridden, overrides: { 'direct@1.0.0': archive } }
    expect(sbomInputProblems([manifest], scoped, scoped, { overrides: scoped['overrides'] })).toEqual([])
  })
})

describe('SBOM identities and relationships', () => {
  it('records declared workspace roles without deleting generator metadata', () => {
    const enriched: unknown = sbomWithWorkspaceRoles(bom, [
      {
        path: 'packages/site',
        packageJson: {
          dependencies: { direct: '1.0.0' },
          devDependencies: { tooling: '2.0.0' },
        },
      },
    ])
    expect(enriched).toMatchObject({
      metadata: {
        properties: [
          {
            name: 'ploaness:direct-workspace-dependency-roles',
            value: JSON.stringify([
              {
                path: 'packages/site',
                dependencies: {
                  dependencies: ['direct'],
                  devDependencies: ['tooling'],
                  optionalDependencies: [],
                },
              },
            ]),
          },
        ],
      },
    })
    expect(
      sbomWithWorkspaceRoles({ ...bom, metadata: { properties: [{ name: 'original', value: 'kept' }] } }, []),
    ).toMatchObject({ metadata: { properties: [{ name: 'original', value: 'kept' }, expect.any(Object)] } })
  })
  it('accepts a complete graph including nested workspace components', () => {
    expect(sbomProblems(bom)).toEqual([])
    const { compositions: _compositions, ...withoutCompositions } = bom
    expect(sbomProblems(withoutCompositions)).toEqual([])
  })
  it.each([
    undefined,
    {},
    { ...bom, bomFormat: 'other' },
    { ...bom, specVersion: '1.5' },
    { ...bom, metadata: {} },
    { ...bom, components: null },
    { ...bom, dependencies: null },
  ])('rejects an unreadable inventory %j', (raw) => {
    expect(sbomProblems(raw)).toEqual([expect.stringContaining('no complete')])
  })
  it('rejects missing identities, duplicate references and unaccounted dependency edges', () => {
    expect(sbomProblems({ ...bom, components: [{}] })).toContain(
      'the SBOM has missing identities or duplicate component references',
    )
    expect(sbomProblems({ ...bom, components: [component('app')] })).toContain(
      'the SBOM has missing identities or duplicate component references',
    )
    expect(sbomProblems({ ...bom, dependencies: [] })).toContain('the SBOM contains no dependency graph')
    for (const edge of [
      {},
      { ref: 'app', dependsOn: null },
      { ref: 'missing', dependsOn: [] },
      { ref: 'app', dependsOn: ['missing'] },
    ]) {
      expect(sbomProblems({ ...bom, dependencies: [edge] })).toContain(
        'the SBOM contains an invalid dependency reference',
      )
    }
    expect(sbomProblems({ ...bom, compositions: [{ aggregate: 'incomplete' }] })).toContain(
      'the generator reports an incomplete inventory',
    )
  })
})

describe('release inventory recovery', () => {
  const evidence: ReleaseEvidence = {
    sourceCommit: 'original',
    sbomSha256: 'bom-hash',
    artifacts: [
      { path: 'one.tgz', sha256: 'one-hash' },
      { path: 'two.tgz', sha256: 'two-hash' },
    ],
  }
  const metadata: Readonly<Record<string, unknown>> = {
    ...evidence,
    schemaVersion: 1,
    scope: SBOM_SCOPE,
    sourceDirty: false,
  }
  it('accepts original evidence independently of archive listing order', () => {
    expect(releaseInventoryProblems({ ...metadata, artifacts: evidence.artifacts.toReversed() }, evidence)).toEqual([])
  })
  it.each([
    { sourceCommit: 'later' },
    { sourceDirty: true },
    { sbomSha256: 'changed' },
    { schemaVersion: 2 },
    { scope: 'unknown' },
    { artifacts: [] },
    { artifacts: [{}] },
    { artifacts: null },
    { artifacts: [{ path: 'one.tgz', sha256: 'wrong' }] },
  ])('rejects mismatched original release evidence %j', (change) => {
    expect(releaseInventoryProblems({ ...metadata, ...change }, evidence).length).toBeGreaterThan(0)
  })
})
