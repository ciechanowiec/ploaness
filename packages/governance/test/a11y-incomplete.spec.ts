import { describe, expect, it } from 'vitest'
import { DEFINITE_INCOMPLETE_KEYS, findDefiniteIncomplete } from '../src/a11y-incomplete.js'

// Captured from a real page, not invented: a skip link drawn in its own background colour, scanned
// with withRules(['color-contrast']). axe filed it under `incomplete` with zero violations, which is
// the whole defect this module answers.
const equalRatioResult = (target: string): unknown => ({
  id: 'color-contrast',
  impact: 'serious',
  nodes: [
    {
      target: [target],
      html: `<a class="skip-link" href="#main-content">Skip to main content</a>`,
      any: [
        {
          id: 'color-contrast',
          message: 'Element has a 1:1 contrast ratio with the background',
          data: {
            fgColor: '#f0c877',
            bgColor: '#f0c877',
            contrastRatio: 1,
            messageKey: 'equalRatio',
            expectedContrastRatio: '4.5:1',
          },
        },
      ],
    },
  ],
})

// The case the narrow list exists to let through: axe cannot measure text over a photograph and says
// so. A project is entitled to that judgement, and a pinned rule that failed it would be unfixable.
const backgroundImageResult = (): unknown => ({
  id: 'color-contrast',
  nodes: [
    {
      target: ['.hero h1'],
      any: [
        {
          id: 'color-contrast',
          message: "Element's background color could not be determined due to a background image",
          data: { messageKey: 'bgImage', contrastRatio: 0 },
        },
      ],
    },
  ],
})

describe('findDefiniteIncomplete', () => {
  it('reports an exactly equal foreground and background', () => {
    const findings: readonly string[] = findDefiniteIncomplete([equalRatioResult('.skip-link')])
    expect(findings).toHaveLength(1)
    expect(findings[0]).toBe(
      'color-contrast on .skip-link: Element has a 1:1 contrast ratio with the background',
    )
  })

  it('stays silent on an incomplete axe genuinely could not decide', () => {
    expect(findDefiniteIncomplete([backgroundImageResult()])).toEqual([])
  })

  it('reports only the definite entry when both are present', () => {
    const findings: readonly string[] = findDefiniteIncomplete([
      backgroundImageResult(),
      equalRatioResult('.site-footer a'),
    ])
    expect(findings).toEqual([
      'color-contrast on .site-footer a: Element has a 1:1 contrast ratio with the background',
    ])
  })

  it('reads a check filed under all or none, not only under any', () => {
    const underAll: unknown = {
      id: 'color-contrast',
      nodes: [
        {
          target: ['button'],
          all: [
            {
              message: 'Element has a 1:1 contrast ratio with the background',
              data: { messageKey: 'equalRatio' },
            },
          ],
        },
      ],
    }
    expect(findDefiniteIncomplete([underAll])).toHaveLength(1)
  })

  it('names a nested target through every frame that reaches it', () => {
    const nested: unknown = {
      id: 'color-contrast',
      nodes: [
        {
          target: ['#preview', '.skip-link'],
          any: [{ message: 'm', data: { messageKey: 'equalRatio' } }],
        },
      ],
    }
    expect(findDefiniteIncomplete([nested])[0]).toBe('color-contrast on #preview >>> .skip-link: m')
  })
})

// The shapes axe can hand back that are not findings: an empty run, a result with no nodes, a check
// with no data. Each returned an empty list already; they are asserted so a future reader of the walk
// can change it without having to rediscover which absences are legal.
describe('findDefiniteIncomplete on incomplete input', () => {
  it('returns nothing for an empty or malformed bucket', () => {
    expect(findDefiniteIncomplete([])).toEqual([])
    expect(findDefiniteIncomplete(undefined)).toEqual([])
    expect(findDefiniteIncomplete([{ id: 'color-contrast' }])).toEqual([])
    expect(findDefiniteIncomplete([{ nodes: [{ any: [{}] }] }])).toEqual([])
  })

  it('says so when axe reported no message for a definite finding', () => {
    const noMessage: unknown = {
      id: 'color-contrast',
      nodes: [{ target: ['a'], any: [{ data: { messageKey: 'equalRatio' } }] }],
    }
    expect(findDefiniteIncomplete([noMessage])[0]).toBe(
      'color-contrast on a: axe reported no message',
    )
  })

  it('names an element it cannot identify rather than reporting an empty target', () => {
    const noTarget: unknown = {
      id: 'color-contrast',
      nodes: [{ target: [], any: [{ message: 'm', data: { messageKey: 'equalRatio' } }] }],
    }
    expect(findDefiniteIncomplete([noTarget])[0]).toBe('color-contrast on (unknown element): m')
  })

  it('enforces equalRatio and nothing wider', () => {
    expect([...DEFINITE_INCOMPLETE_KEYS]).toEqual(['equalRatio'])
  })
})
