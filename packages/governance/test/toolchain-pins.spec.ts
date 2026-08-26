import { describe, expect, it } from 'vitest'
import {
  CONTAINER_IMAGES,
  findPnpmRuntimeViolations,
  findUnpinnedImages,
  minimumNodeMajor,
  pinnedPnpmVersion,
} from '../src/toolchain-pins.js'

describe('CONTAINER_IMAGES', () => {
  // The joint worth testing: not that a constant equals its own literal, but that nobody can put a
  // mutable tag back without a named test failure. `:latest` is how these three were declared before.
  it('pins every containerised analyzer to an exact digest', () => {
    expect(findUnpinnedImages(CONTAINER_IMAGES)).toEqual([])
  })

  // shellcheck is here without a gate of its own: no governed project is required to ship a shell
  // script, so there is nothing for a gate to run. What runs it is the ploaness verification command,
  // over the scripts that implement ploaness's own checks - which the standard makes source code.
  it('declares an image for every containerised analyzer', () => {
    expect(
      Object.keys(CONTAINER_IMAGES).toSorted((left: string, right: string): number =>
        left.localeCompare(right),
      ),
    ).toEqual(['actionlint', 'gitleaks', 'hadolint', 'shellcheck'])
  })
})

describe('findUnpinnedImages', () => {
  it('rejects a floating latest tag', () => {
    const found: readonly string[] = findUnpinnedImages({ gitleaks: 'zricethezav/gitleaks:latest' })
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('<repo>:<tag>@sha256:<digest>')
  })

  // A digest alone is reproducible but says nothing about which release it is, which is how the version
  // came to live in a comment and go stale there. The freshness report reads the tag, so both are required.
  it('rejects a digest carrying no tag, which names bytes but no release', () => {
    const digest: string = `sha256:${'a'.repeat(64)}`
    expect(findUnpinnedImages({ gitleaks: `zricethezav/gitleaks@${digest}` })).toHaveLength(1)
  })

  it('rejects a version tag, which the registry may still repoint', () => {
    expect(findUnpinnedImages({ hadolint: 'hadolint/hadolint:v2.14.0' })).toHaveLength(1)
  })

  it('rejects a digest that is not a full sha256', () => {
    expect(findUnpinnedImages({ actionlint: 'rhysd/actionlint@sha256:abc' })).toHaveLength(1)
  })

  it('names the tool, so the report says which pin to move', () => {
    expect(findUnpinnedImages({ hadolint: 'hadolint/hadolint:latest' })[0]).toContain('hadolint')
  })

  it('accepts a reference naming both the release and its bytes', () => {
    const digest: string = `sha256:${'a'.repeat(64)}`
    expect(findUnpinnedImages({ gitleaks: `zricethezav/gitleaks:v8.30.1@${digest}` })).toEqual([])
  })
})

// The Node floor `preflight` decides a verdict with. It used to be a constant in the CLI, which put a
// rule in the I/O layer and made a fourth copy of a number `pins.json` already states.
describe('minimumNodeMajor', () => {
  it.each([
    ['>=26', 26],
    ['>= 26', 26],
    ['26', 26],
    ['^26.1.0', 26],
    ['>=26 <28', 26],
  ])('reads %j as %i', (range: string, expected: number) => {
    expect(minimumNodeMajor(range)).toBe(expected)
  })

  it('reads a range naming no major as naming none', () => {
    expect(minimumNodeMajor('*')).toBeUndefined()
  })

  it('reads an absent range as naming none, rather than as zero', () => {
    expect(minimumNodeMajor(undefined)).toBeUndefined()
  })
})

// The single source of the pnpm version. `engines.pnpm` used to state it a second time, as a `>=11`
// floor beside an exact `pnpm@11.9.0`, so the two fields disagreed about what a conforming project ran.
describe('pinnedPnpmVersion', () => {
  it('reads the exact version out of the specifier', () => {
    expect(pinnedPnpmVersion('pnpm@11.9.0')).toBe('11.9.0')
  })

  it('reads past the integrity suffix Corepack writes, which names the same version', () => {
    expect(pinnedPnpmVersion(`pnpm@11.9.0+sha512.${'a'.repeat(16)}`)).toBe('11.9.0')
  })

  it('names no version for another package manager', () => {
    expect(pinnedPnpmVersion('yarn@4.5.0')).toBeUndefined()
  })

  it('names no version when the field is absent, rather than an empty one', () => {
    expect(pinnedPnpmVersion(undefined)).toBeUndefined()
  })
})

// `packageManager` is a declaration; this is the pnpm that actually resolved the tree. A project passed
// the wiring gate declaring `pnpm@11.9.0` and installed under 11.5.0 wherever Corepack was not enabled,
// which made the pin a comment for exactly the tool that decides what every other pin resolves to.
const agent = (version: string): string => `pnpm/${version} npm/? node/v26.2.0 darwin arm64`

describe('findPnpmRuntimeViolations', () => {
  it('reports a running pnpm that is not the pinned one', () => {
    const found: readonly string[] = findPnpmRuntimeViolations(agent('11.5.0'), '11.9.0')
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('11.5.0')
  })

  it('names the pinned version, so the report says which pnpm to run', () => {
    expect(findPnpmRuntimeViolations(agent('11.5.0'), '11.9.0')[0]).toContain('pnpm@11.9.0')
  })

  it('says nothing when the running pnpm is the pinned one', () => {
    expect(findPnpmRuntimeViolations(agent('11.9.0'), '11.9.0')).toEqual([])
  })

  // Not started by pnpm at all: npx, a direct node invocation, a CI step calling the binary. There is
  // no version to disagree with, and failing there would report a project for how one command was
  // launched rather than for what it declared.
  it.each([undefined, '', 'npm/11.0.0 node/v26.2.0 darwin arm64'])(
    'says nothing when %j names no pnpm',
    (userAgent: string | undefined) => {
      expect(findPnpmRuntimeViolations(userAgent, '11.9.0')).toEqual([])
    },
  )

  it('does not read @pnpm/exe as pnpm, whose version is a different number', () => {
    expect(findPnpmRuntimeViolations('@pnpm/exe/11.5.0 node/v26.2.0', '11.9.0')).toEqual([])
  })

  it('says nothing when ploaness pins no package manager', () => {
    expect(findPnpmRuntimeViolations(agent('11.5.0'), undefined)).toEqual([])
  })
})
