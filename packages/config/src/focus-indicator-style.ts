// The focused element's own outline and shadows, read in the page while it holds focus, so the focus
// rules can compare the whole of its indicator. Self-contained: Playwright ships it to the page as text.
import type { IndicatorStyle } from '@ploaness/governance'

declare const document: { readonly activeElement: object | null }
declare const getComputedStyle: (element: object) => IndicatorStyle

/**
 * The outline and box shadow of the focused element, or none when nothing holds focus.
 * @returns the computed styles.
 */
export const indicatorStyleInPage = (): IndicatorStyle => {
  const active: object | null = document.activeElement
  if (active === null) {
    return { outlineStyle: 'none', outlineWidth: '0px', outlineOffset: '0px', boxShadow: 'none' }
  }
  const style: IndicatorStyle = getComputedStyle(active)
  return {
    outlineStyle: style.outlineStyle,
    outlineWidth: style.outlineWidth,
    outlineOffset: style.outlineOffset,
    boxShadow: style.boxShadow,
  }
}
