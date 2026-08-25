import { describe, expect, it } from 'vitest'
import { findVersionViolations, type VersionInputs } from '../src/version-policy.js'

// This module had no spec of its own. It cleared the per-file coverage floor through `wiring-policy`'s
// tests, which exercise it as a side effect of asking a different question - so no test named any of
// the seven rules here, and none of them would have failed if its behaviour were deleted.

const inputs = (overrides: Partial<VersionInputs> = {}): VersionInputs => ({
  expected: { vitest: '4.1.11', payload: '3.60.0' },
  required: new Set(['vitest']),
  payloadVersion: '3.60.0',
  requiredPackageManager: 'pnpm@11.9.0',
  requiredEngines: { node: '>=26' },
  workspaceFile: '',
  ...overrides,
})

const wired = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  devDependencies: { vitest: '4.1.11' },
  packageManager: 'pnpm@11.9.0',
  engines: { node: '>=26' },
  ...overrides,
})

const locationsOf = (
  packageJson: Record<string, unknown>,
  overrides: Partial<VersionInputs> = {},
): readonly string[] =>
  findVersionViolations(packageJson, inputs(overrides)).map((violation) => violation.location)

describe('a version ploaness pins', () => {
  it('says nothing about a correctly wired project', () => {
    expect(findVersionViolations(wired(), inputs())).toEqual([])
  })

  it('reports a required package the project never declares', () => {
    expect(locationsOf({ packageManager: 'pnpm@11.9.0', engines: { node: '>=26' } })).toContain(
      'package.json vitest',
    )
  })

  it('reports a pinned package declared at another version', () => {
    expect(locationsOf(wired({ devDependencies: { vitest: '4.0.0' } }))).toContain(
      'package.json devDependencies.vitest',
    )
  })

  it('leaves a pinned package the project has no use for undeclared', () => {
    expect(locationsOf(wired())).not.toContain('package.json payload')
  })

  // The block a finding names has to be the block the version was read from, or the reader is sent to
  // the wrong half of the file.
  it('names the block the package is actually declared in', () => {
    expect(
      locationsOf(wired({ devDependencies: {}, dependencies: { vitest: '4.0.0' } })),
    ).toContain('package.json dependencies.vitest')
  })
})

const declaring = (specifier: string): Record<string, unknown> =>
  wired({ dependencies: { next: specifier } })

describe('a specifier that is not one exact version', () => {
  it.each(['^16.3.2', '~16.3.2', '>=16.3.2', '*', '', '16.x', '1.0.0 || 2.0.0', '1.0.0 - 2.0.0'])(
    'reports the range %j',
    (specifier: string) => {
      expect(locationsOf(declaring(specifier))).toContain('package.json next')
    },
  )

  // A dist tag is the widest range there is: it resolves to wherever the publisher last moved it. The
  // rule tested only for range SYNTAX, so every one of these passed as though it were a pinned version.
  it.each(['latest', 'next', 'beta', 'canary'])(
    'reports the dist tag %j, which floats like a range',
    (specifier: string) => {
      expect(locationsOf(declaring(specifier))).toContain('package.json next')
    },
  )

  it('accepts an exact version', () => {
    expect(locationsOf(declaring('16.3.2'))).not.toContain('package.json next')
  })

  // `.x` was matched unanchored, so a legitimate prerelease containing those two characters was
  // reported as a range.
  it('accepts an exact prerelease whose label contains an x', () => {
    expect(locationsOf(declaring('1.0.0-canary.x1'))).not.toContain('package.json next')
  })

  it('leaves an artefact specifier alone, since it names no range at all', () => {
    expect(locationsOf(declaring('file:../next.tgz'))).not.toContain('package.json next')
  })

  it('reads past an npm alias to the version it carries', () => {
    expect(locationsOf(declaring('npm:preact@^10'))).toContain('package.json next')
  })

  it('accepts an npm alias pinned exactly', () => {
    expect(locationsOf(declaring('npm:preact@10.0.0'))).not.toContain('package.json next')
  })
})

describe('the Payload family', () => {
  it('reports a @payloadcms package that disagrees with payload', () => {
    const packageJson: Record<string, unknown> = wired({
      dependencies: { payload: '3.60.0', '@payloadcms/db-postgres': '3.59.0' },
    })
    expect(locationsOf(packageJson)).toContain('package.json @payloadcms/db-postgres')
  })

  it('accepts a @payloadcms package at the pinned payload version', () => {
    const packageJson: Record<string, unknown> = wired({
      dependencies: { payload: '3.60.0', '@payloadcms/db-postgres': '3.60.0' },
    })
    expect(locationsOf(packageJson)).not.toContain('package.json @payloadcms/db-postgres')
  })
})

describe('the runtime a project declares', () => {
  it('reports a packageManager that is not the pinned one', () => {
    expect(locationsOf(wired({ packageManager: 'pnpm@11.5.0' }))).toContain(
      'package.json packageManager',
    )
  })

  it('reports an engines entry that is not the required range', () => {
    expect(locationsOf(wired({ engines: { node: '>=22' } }))).toContain('package.json engines.node')
  })

  it('reports a missing engines block', () => {
    expect(locationsOf(wired({ engines: {} }))).toContain('package.json engines.node')
  })
})

describe('the ways to change what a pin installs without changing the pin', () => {
  it.each(['overrides', 'resolutions', 'patchedDependencies', 'packageExtensions'])(
    'reports a %s entry in package.json naming a pinned package',
    (key: string) => {
      expect(locationsOf(wired({ [key]: { vitest: '4.0.0' } }))).toContain(
        `package.json ${key}.vitest`,
      )
    },
  )

  it('reads the same keys under the pnpm block', () => {
    expect(locationsOf(wired({ pnpm: { overrides: { vitest: '4.0.0' } } }))).toContain(
      'package.json overrides.vitest',
    )
  })

  it('reads a patch key past the version it is qualified by', () => {
    expect(
      locationsOf(wired({ pnpm: { patchedDependencies: { 'vitest@4.1.11': 'p.patch' } } })),
    ).toContain('package.json patchedDependencies.vitest@4.1.11')
  })

  it('reports a workspace override of a package the project declares itself', () => {
    const workspaceFile: string = ['overrides:', '  left-pad: 1.0.0'].join('\n')
    const packageJson: Record<string, unknown> = wired({ dependencies: { 'left-pad': '1.1.0' } })
    expect(locationsOf(packageJson, { workspaceFile })).toContain(
      'pnpm-workspace.yaml overrides.left-pad',
    )
  })

  it('leaves an override of a transitive package alone, which is the one permitted case', () => {
    const workspaceFile: string = ['overrides:', '  deepmerge-ts: ^8.0.2'].join('\n')
    expect(locationsOf(wired(), { workspaceFile })).toEqual([])
  })

  // A plain version, then the two alias forms. An override value carries colons of its own, and the
  // reader split at the LAST one - so every alias parsed as a package name nothing could match, and
  // walked straight through the rule that exists to catch it.
  it.each(['4.0.0', 'npm:vitest-fork@4.0.0', 'link:../my-vitest'])(
    'reports a workspace override of a pinned package written as %j',
    (specifier: string) => {
      const workspaceFile: string = ['overrides:', `  vitest: ${specifier}`].join('\n')
      expect(locationsOf(wired(), { workspaceFile })).toContain(
        'pnpm-workspace.yaml overrides.vitest',
      )
    },
  )
})

// The harness's own packages are the one case the rule permits deliberately rather than by omission.
describe('an override of the harness itself', () => {
  // The pre-publication arrangement `it/verify.sh` runs on. It used to pass only because the reader
  // could not parse the line; it passes deliberately now.
  it('permits the harness own packages pointed at a local artefact', () => {
    const workspaceFile: string = [
      'overrides:',
      '  ploaness: "file:../dist-tarballs/ploaness-1.0.0.tgz"',
      '  "@ploaness/cli": "file:../dist-tarballs/ploaness-cli-1.0.0.tgz"',
    ].join('\n')
    const packageJson: Record<string, unknown> = wired({ dependencies: { ploaness: '1.0.0' } })
    expect(locationsOf(packageJson, { workspaceFile })).toEqual([])
  })

  it('still reports the harness packages overridden to another registry version', () => {
    const workspaceFile: string = ['overrides:', '  ploaness: 2.0.0'].join('\n')
    const packageJson: Record<string, unknown> = wired({ dependencies: { ploaness: '1.0.0' } })
    expect(locationsOf(packageJson, { workspaceFile })).toContain(
      'pnpm-workspace.yaml overrides.ploaness',
    )
  })
})
