import { describe, expect, it } from 'vitest'
import { FOCUS_RING_WIDTH } from '../src/browser-rules.js'
import { type IndicatorStyle, indicatorReach } from '../src/focus-reach.js'

const style = (overrides: Partial<IndicatorStyle>): IndicatorStyle => ({
  outlineStyle: 'none',
  outlineWidth: '0px',
  outlineOffset: '0px',
  boxShadow: 'none',
  ...overrides,
})

describe('how far the indicator of a focused element reaches beyond its box', () => {
  it('reaches a ring drawn as a shadow beyond an offset gap, as a Tailwind ring with an offset is', () => {
    expect(
      indicatorReach(
        style({
          boxShadow:
            'rgb(15, 23, 42) 0px 0px 0px 4px, rgb(250, 204, 21) 0px 0px 0px 6px, rgba(0, 0, 0, 0) 0px 0px 0px 0px',
        }),
      ),
    ).toBe(7)
  })

  it('reaches an outline drawn at an offset', () => {
    expect(indicatorReach(style({ outlineStyle: 'solid', outlineWidth: '2px', outlineOffset: '6px' }))).toBe(9)
  })

  it('takes the farther of an outline and a shadow', () => {
    expect(
      indicatorReach(
        style({
          outlineStyle: 'solid',
          outlineWidth: '2px',
          outlineOffset: '2px',
          boxShadow: 'rgb(0, 0, 0) 0px 4px 10px 2px',
        }),
      ),
    ).toBe(17)
  })

  it('ignores a shadow drawn inside the box, and an outline that is not drawn', () => {
    expect(
      indicatorReach(
        style({ outlineStyle: 'none', outlineWidth: '12px', boxShadow: 'oklch(0.5 0.1 200) 0px 0px 0px 12px inset' }),
      ),
    ).toBe(FOCUS_RING_WIDTH)
  })

  it('keeps the fixed margin for an indicator inside it or none at all', () => {
    expect(indicatorReach(style({}))).toBe(FOCUS_RING_WIDTH)
    expect(indicatorReach(style({ outlineStyle: 'solid', outlineWidth: '1px', outlineOffset: '-3px' }))).toBe(
      FOCUS_RING_WIDTH,
    )
  })
})
