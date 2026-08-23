import { describe, expect, it } from 'vitest'
import { CONTAINER_IMAGES, findUnpinnedImages } from '../src/toolchain-pins.js'

describe('CONTAINER_IMAGES', () => {
  // The joint worth testing: not that a constant equals its own literal, but that nobody can put a
  // mutable tag back without a named test failure. `:latest` is how these three were declared before.
  it('pins every containerised analyzer to an exact digest', () => {
    expect(findUnpinnedImages(CONTAINER_IMAGES)).toEqual([])
  })

  it('declares an image for every tool the gates run in a container', () => {
    expect(
      Object.keys(CONTAINER_IMAGES).toSorted((left: string, right: string): number =>
        left.localeCompare(right),
      ),
    ).toEqual(['actionlint', 'gitleaks', 'hadolint'])
  })
})

describe('findUnpinnedImages', () => {
  it('rejects a floating latest tag', () => {
    const found: readonly string[] = findUnpinnedImages({ gitleaks: 'zricethezav/gitleaks:latest' })
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('mutable reference')
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

  it('accepts a digest reference', () => {
    const digest: string = `sha256:${'a'.repeat(64)}`
    expect(findUnpinnedImages({ gitleaks: `zricethezav/gitleaks@${digest}` })).toEqual([])
  })
})
