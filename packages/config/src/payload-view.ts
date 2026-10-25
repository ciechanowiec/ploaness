// A project's own scan of a custom Payload admin view judges the view's own content, never Payload's
// navigation, header or frame, which the project neither writes nor can repair. The scan marks the
// view's roots for its duration; the layout measurement and axe then keep to them.
import type { Page } from '@playwright/test'

// Where a Payload admin template renders the view's own content: the default template's column after
// Payload's header, and the minimal template's column.
const PAYLOAD_VIEW_ROOTS: string = '.template-default__wrap > :not(.app-header), .template-minimal__wrap > *'

// The layout measurement spells this attribute out in the page code that skips what lies outside it.
const VIEW_ATTRIBUTE: string = 'data-ploaness-view'

/** The marked roots of a Payload view, for an axe scan limited to them. */
export const VIEW_ROOT_SELECTOR: string = `[${VIEW_ATTRIBUTE}]`

interface MarkedElement {
  readonly setAttribute: (name: string, value: string) => void
  readonly removeAttribute: (name: string) => void
}

declare const document: {
  readonly querySelectorAll: (selectors: string) => ArrayLike<MarkedElement>
}

const hasMarkedInPage = ([selector, attribute]: readonly [string, string]): boolean => {
  const roots: readonly MarkedElement[] = Array.from(document.querySelectorAll(selector))
  for (const root of roots) {
    root.setAttribute(attribute, '')
  }
  return roots.length > 0
}

const unmarkInPage = ([selector, attribute]: readonly [string, string]): void => {
  const roots: readonly MarkedElement[] = Array.from(document.querySelectorAll(selector))
  for (const root of roots) {
    root.removeAttribute(attribute)
  }
}

/**
 * Mark the roots of a Payload admin view, so the scans that follow judge the view's own content. A page
 * that is not a Payload admin view is left as it is.
 * @param page the page.
 * @returns whether it is a Payload admin view, now marked.
 */
export const hasMarkedPayloadView = async (page: Page): Promise<boolean> =>
  await page.evaluate(hasMarkedInPage, [PAYLOAD_VIEW_ROOTS, VIEW_ATTRIBUTE] as const)

/**
 * Remove the marks `hasMarkedPayloadView` set, leaving the page as the spec drove it.
 * @param page the page.
 */
export const unmarkPayloadView = async (page: Page): Promise<void> => {
  await page.evaluate(unmarkInPage, [VIEW_ROOT_SELECTOR, VIEW_ATTRIBUTE] as const)
}
