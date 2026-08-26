// The image half of the freshness rule, exercised without a registry.
//
// Every case here supplies the tag list a registry would have returned. That is the whole reason the
// decisions live in `governance` rather than beside the HTTP: a rule that reads its own network can
// only be tested against one, and these are the cases a live registry would never produce on demand.

import { describe, expect, it } from 'vitest'
import {
  type ContainerReference,
  type ContainerTag,
  type ContainerVerdict,
  compareContainerTags,
  describeContainerDrift,
  describeContainerUpdate,
  judgeContainer,
  latestOfScheme,
  matchesTagScheme,
  parseContainerReference,
  parseContainerTag,
} from '../src/container-freshness.js'

const DIGEST: string = `sha256:${'a'.repeat(64)}`
const OTHER_DIGEST: string = `sha256:${'b'.repeat(64)}`

const referenceOf = (reference: string): ContainerReference => {
  const parsed: ContainerReference | undefined = parseContainerReference('actionlint', reference)
  if (parsed === undefined) {
    throw new Error(`the fixture reference did not parse: ${reference}`)
  }
  return parsed
}

const tagOf = (raw: string): ContainerTag => {
  const parsed: ContainerTag | undefined = parseContainerTag(raw)
  if (parsed === undefined) {
    throw new Error(`the fixture tag did not parse: ${raw}`)
  }
  return parsed
}

describe('parseContainerReference', () => {
  it('splits a pinned reference into the parts a registry addresses it by', () => {
    const parsed: ContainerReference = referenceOf(`rhysd/actionlint:1.7.12@${DIGEST}`)
    expect(parsed).toStrictEqual({
      tool: 'actionlint',
      name: 'rhysd/actionlint',
      namespace: 'rhysd',
      repository: 'actionlint',
      tag: '1.7.12',
      digest: DIGEST,
    })
  })

  it('rejects a reference carrying a digest but no tag', () => {
    expect(parseContainerReference('actionlint', `rhysd/actionlint@${DIGEST}`)).toBeUndefined()
  })

  it('rejects a reference carrying a tag but no digest', () => {
    expect(parseContainerReference('actionlint', 'rhysd/actionlint:1.7.12')).toBeUndefined()
  })
})

describe('parseContainerTag', () => {
  it('reads a leading v as part of the scheme rather than the number', () => {
    expect(tagOf('v2.15.1')).toStrictEqual({
      raw: 'v2.15.1',
      prefix: 'v',
      parts: [2, 15, 1],
      isCalendar: false,
    })
  })

  it('reads a four-digit leading component as a calendar line', () => {
    expect(tagOf('2024.1.0').isCalendar).toBe(true)
  })

  it('refuses a tag carrying a variant or prerelease suffix', () => {
    expect(parseContainerTag('2.15.1-alpine')).toBeUndefined()
    expect(parseContainerTag('1.7.12-rc1')).toBeUndefined()
  })

  it('refuses a single-component tag, which cannot be told from a build number', () => {
    expect(parseContainerTag('8')).toBeUndefined()
    expect(parseContainerTag('latest')).toBeUndefined()
  })
})

describe('sameTagScheme', () => {
  it('separates a v-prefixed line from an unprefixed one', () => {
    expect(matchesTagScheme(tagOf('v2.15.1'), tagOf('2.15.1'))).toBe(false)
  })

  it('separates lines of differing component counts', () => {
    expect(matchesTagScheme(tagOf('2.15'), tagOf('2.15.1'))).toBe(false)
  })

  it('separates a calendar line from an ordinary one', () => {
    expect(matchesTagScheme(tagOf('2024.1.0'), tagOf('2.15.1'))).toBe(false)
  })

  it('accepts two tags of one line', () => {
    expect(matchesTagScheme(tagOf('v2.15.1'), tagOf('v2.9.0'))).toBe(true)
  })
})

describe('compareContainerTags', () => {
  it('orders by component rather than by string, so 10 follows 9', () => {
    expect(compareContainerTags(tagOf('1.7.10'), tagOf('1.7.9'))).toBeGreaterThan(0)
  })

  it('treats an absent trailing component as zero', () => {
    expect(compareContainerTags(tagOf('1.7.0'), tagOf('1.7.0'))).toBe(0)
  })
})

describe('latestOfScheme', () => {
  it('ignores every tag outside the pinned tag scheme', () => {
    const newest: ContainerTag = latestOfScheme(tagOf('v2.15.1'), [
      'v2.15.1',
      '2.99.0',
      'v3.0',
      'latest',
      '2024.9.1',
    ])
    expect(newest.raw).toBe('v2.15.1')
  })

  it('returns the pinned tag when the registry publishes nothing newer', () => {
    expect(latestOfScheme(tagOf('1.7.12'), ['1.7.11', '1.7.12']).raw).toBe('1.7.12')
  })

  it('finds a newer tag that sorts below its predecessor as a string', () => {
    expect(latestOfScheme(tagOf('1.7.9'), ['1.7.9', '1.7.10']).raw).toBe('1.7.10')
  })
})

describe('judgeContainer', () => {
  it('reports no update and no drift for a pin that is current', () => {
    expect(
      judgeContainer({
        reference: referenceOf(`rhysd/actionlint:1.7.12@${DIGEST}`),
        available: ['1.7.11', '1.7.12'],
        currentDigest: DIGEST,
      }),
    ).toStrictEqual({
      reference: referenceOf(`rhysd/actionlint:1.7.12@${DIGEST}`),
      newer: undefined,
      hasDrifted: false,
      currentDigest: DIGEST,
    })
  })

  it('reports the newer tag when the registry publishes one', () => {
    const verdict: ContainerVerdict = judgeContainer({
      reference: referenceOf(`rhysd/actionlint:1.7.7@${DIGEST}`),
      available: ['1.7.7', '1.7.12'],
      currentDigest: DIGEST,
    })
    expect(verdict.newer?.raw).toBe('1.7.12')
  })

  it('reports drift when the declared tag no longer resolves to the pinned bytes', () => {
    const verdict: ContainerVerdict = judgeContainer({
      reference: referenceOf(`rhysd/actionlint:1.7.12@${DIGEST}`),
      available: ['1.7.12'],
      currentDigest: OTHER_DIGEST,
    })
    expect(verdict.hasDrifted).toBe(true)
    expect(verdict.currentDigest).toBe(OTHER_DIGEST)
  })

  it('reports no update for a pinned tag it cannot read as a version', () => {
    const verdict: ContainerVerdict = judgeContainer({
      reference: referenceOf(`rhysd/actionlint:latest@${DIGEST}`),
      available: ['1.7.12'],
      currentDigest: DIGEST,
    })
    expect(verdict.newer).toBeUndefined()
  })
})

describe('the report lines', () => {
  it('names the declaring property and the whole replacement reference', () => {
    expect(
      describeContainerUpdate(
        referenceOf(`rhysd/actionlint:1.7.7@${DIGEST}`),
        tagOf('1.7.12'),
        OTHER_DIGEST,
      ),
    ).toBe(
      `update actionlint rhysd/actionlint:1.7.7 -> 1.7.12; pin rhysd/actionlint:1.7.12@${OTHER_DIGEST}`,
    )
  })

  it('names both digests, and says the pin still holds', () => {
    const line: string = describeContainerDrift(
      referenceOf(`rhysd/actionlint:1.7.12@${DIGEST}`),
      OTHER_DIGEST,
    )
    expect(line).toContain(DIGEST)
    expect(line).toContain(OTHER_DIGEST)
    expect(line).toContain('still names the bytes')
  })
})
