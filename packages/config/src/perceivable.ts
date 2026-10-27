// IntersectionObserver supplies the painted intersection after ancestor clipping, transforms and
// scrolling. Visibility alone treats a zero-opacity element as visible and cannot establish this.
import { expect, type Locator } from '@playwright/test'

interface ElementInPage {
  readonly parentElement: ElementInPage | null
  readonly checkVisibility: (options: {
    readonly opacityProperty: boolean
    readonly visibilityProperty: boolean
  }) => boolean
  readonly closest: (selector: string) => ElementInPage | null
}

interface Observation {
  readonly intersectionRect: { readonly width: number; readonly height: number }
}

interface Observer {
  readonly observe: (element: ElementInPage) => void
  readonly disconnect: () => void
}

declare const IntersectionObserver: new (
  callback: (entries: readonly Observation[], observer: Observer) => void,
) => Observer
declare const getComputedStyle: (element: ElementInPage) => { readonly opacity: string }

const isPerceivableInPage = async (element: ElementInPage): Promise<boolean> => {
  const opacity = (node: ElementInPage | null): number =>
    node === null ? 1 : Number(getComputedStyle(node).opacity) * opacity(node.parentElement)
  if (
    !element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) ||
    element.closest('[inert]') !== null ||
    opacity(element) <= 0
  ) {
    return false
  }
  return await new Promise<boolean>((resolve: (isVisible: boolean) => void): void => {
    const observer: Observer = new IntersectionObserver((entries: readonly Observation[], observed: Observer): void => {
      observed.disconnect()
      const box: Observation['intersectionRect'] | undefined = entries[0]?.intersectionRect
      resolve(box !== undefined && box.width > 0 && box.height > 0)
    })
    observer.observe(element)
  })
}

const REVEAL_TIMEOUT_MS: number = 1500

/**
 * Assert a control becomes perceivable without scrolling or focusing it on the test's behalf.
 * @param control the element whose own interaction must leave it visible.
 */
export const expectPerceivable = async (control: Locator): Promise<void> => {
  await expect
    .poll(async (): Promise<boolean> => await control.evaluate(isPerceivableInPage), {
      timeout: REVEAL_TIMEOUT_MS,
      message: 'the control must have painted area in the viewport, nonzero ancestor opacity and no inert ancestor',
    })
    .toBe(true)
}

/**
 * Measure the same obligation for an aggregating sweep. An unreadable control fails too.
 * @param control the control being judged.
 * @returns whether it met the bounded visibility assertion.
 */
export const isPerceivableWithin = async (control: Locator): Promise<boolean> => {
  try {
    await expectPerceivable(control)
    return true
  } catch {
    return false
  }
}
