import { describe, expect, it } from 'vitest'
import {
  applyExemptions,
  type DeclaredExemption,
  declaredExemptions,
  EXEMPTIBLE_RULES,
  type ExemptionCarrier,
  exemptionRules,
  judgeCarried,
  malformedExemptions,
  staleExemptions,
} from '../src/browser-exemptions.js'
import { type BrowserFinding, type FindingPlace, findingAt } from '../src/browser-findings.js'
import type { LayoutNode, LayoutSnapshot } from '../src/layout-snapshot.js'
import { BODY, nodeOf, snapshotOf } from './layout-fixture.js'

const PLACE: FindingPlace = {
  location: '/en/account/verify',
  state: 'resting',
  engine: 'chromium',
  viewport: { width: 390, height: 844 },
}

// A figure that declares an exemption for its image, and the image inside it.
const figure = (exemption: string | undefined, reason: string = 'the poster is a fixed crop'): LayoutSnapshot =>
  snapshotOf([
    BODY,
    nodeOf({ index: 1, parent: 0, tag: 'figure', label: 'figure.poster', exemption, exemptionReason: reason }),
    nodeOf({ index: 2, parent: 1, tag: 'img', label: 'img.poster' }),
  ])

const malformedMessages = (snapshot: LayoutSnapshot): readonly string[] =>
  malformedExemptions(snapshot, PLACE).map((finding): string => finding.message)

const imageOf = (snapshot: LayoutSnapshot): LayoutNode => snapshot.nodes[2] ?? BODY

describe('the rules an exemption names', () => {
  it('reads space-separated names once each', () => {
    expect(exemptionRules(' attached  image-distorted attached ')).toEqual(['attached', 'image-distorted'])
  })

  it('reads nothing from an absent attribute', () => {
    expect(exemptionRules(undefined)).toEqual([])
  })
})

describe('applying exemptions', () => {
  it('lets an ancestor excuse the rule it names, and records that it did', () => {
    const snapshot: LayoutSnapshot = figure('image-distorted')
    expect(
      applyExemptions(snapshot, PLACE, [
        { rule: 'image-distorted', subjects: [imageOf(snapshot)], message: 'stretched' },
        { rule: 'image-upscaled', subjects: [imageOf(snapshot)], message: 'enlarged' },
      ]),
    ).toEqual({
      findings: [{ ...PLACE, rule: 'image-upscaled', message: 'enlarged', elements: [2] }],
      used: [{ location: PLACE.location, key: 'body/figure:0', rule: 'image-distorted' }],
    })
  })
})

describe('malformed exemptions', () => {
  it('passes a known rule with a reason', () => {
    expect(malformedExemptions(figure('image-distorted'), PLACE)).toEqual([])
  })

  it('fails an unknown rule, an empty list and a missing reason', () => {
    expect([...malformedMessages(figure('stretched', '')), ...malformedMessages(figure(' '))]).toEqual([
      'unknown rule "stretched" in data-ploaness-layout on figure.poster; ' +
        `the exemptible rules are ${EXEMPTIBLE_RULES.join(', ')}`,
      'layout exemption without a reason on figure.poster; state it in data-ploaness-layout-reason',
      'data-ploaness-layout names no rule on figure.poster',
    ])
  })
})

describe('stale exemptions', () => {
  const declared: readonly DeclaredExemption[] = declaredExemptions(
    figure('image-distorted small-text'),
    PLACE.location,
  )

  it('reports each named rule that excused nothing among the rules that ran', () => {
    expect(
      staleExemptions(
        declared,
        [{ location: PLACE.location, key: 'body/figure:0', rule: 'image-distorted' }],
        ['image-distorted', 'small-text'],
        'chromium',
      ).map((finding): string => finding.message),
    ).toEqual([
      'stale layout exemption "small-text" on figure.poster: it excuses nothing in any pass, viewport, engine or ' +
        'state; remove it from data-ploaness-layout',
    ])
  })

  it('cannot judge a rule that never ran', () => {
    expect(staleExemptions(declared, [], ['overflow'], 'chromium')).toEqual([])
  })
})

describe('exemptions above an element found by driving the page', () => {
  const finding: BrowserFinding = findingAt(PLACE, 'focus-visible', 'no visible focus: a.card')
  const carrier: ExemptionCarrier = {
    key: 'body/main:0',
    label: 'main',
    rules: 'focus-visible',
    reason: 'the card draws its own ring',
  }

  it('excuses the rule a carrier names, and records it as used', () => {
    expect(judgeCarried(finding, [carrier])).toEqual({
      finding: undefined,
      used: [{ location: PLACE.location, key: 'body/main:0', rule: 'focus-visible' }],
      declared: [{ location: PLACE.location, key: 'body/main:0', label: 'main', rules: ['focus-visible'] }],
    })
  })

  it('keeps a finding no carrier names', () => {
    expect(judgeCarried(finding, [{ ...carrier, rules: 'attached' }]).finding).toEqual(finding)
  })
})
