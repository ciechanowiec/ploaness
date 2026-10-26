// The faces the page's text uses, loaded before the page is measured. A browser asks for a face only once
// text that needs it has been laid out, and until then the face is `unloaded`, which `document.fonts.ready`
// does not wait for. Text that appears late - a story Storybook renders after the load event, a panel a
// control reveals - is laid out after the settle has passed its font wait, and on a loaded machine WebKit
// may not yet have asked for the face when the page is measured: the font rule would then report a face a
// moment from loading. Every face of each family the page's text asks for first is therefore loaded now,
// as the rule counts a family used. A face that fails is left failed, for the rule to report.
//
// Self-contained, as the settle is: Playwright ships this function to the page as source text.

interface PageFontFace {
  readonly family: string
  readonly status: string
  readonly load: () => Promise<unknown>
}

interface PageTextElement {
  readonly childNodes: ArrayLike<{ readonly nodeType: number; readonly textContent: string | null }>
}

declare const document: {
  readonly fonts: Iterable<PageFontFace> | undefined
  readonly querySelectorAll: (selectors: string) => ArrayLike<PageTextElement>
}
declare const getComputedStyle: (element: PageTextElement) => { readonly fontFamily: string }
declare const setTimeout: (callback: () => void, delayMs: number) => unknown

/**
 * The declared families the page's text asks for first, as the font rule counts them, while any face is
 * yet to load; none once every face has loaded or failed.
 * @returns the families, unquoted and in lower case.
 */
export const usedFontFamiliesInPage = (): readonly string[] => {
  const faces: readonly PageFontFace[] = Array.from(document.fonts ?? [])
  if (!faces.some((face: PageFontFace): boolean => face.status === 'unloaded' || face.status === 'loading')) {
    return []
  }
  const textNodeType: number = 3
  // Each family as the rule compares it: unquoted and in lower case. Written inline twice, because a
  // helper here would be hoisted out of the page's reach.
  const declared: ReadonlySet<string> = new Set<string>(
    faces.map((face: PageFontFace): string =>
      face.family
        .trim()
        .replaceAll(/^["']|["']$/gu, '')
        .toLowerCase(),
    ),
  )
  return [
    ...new Set<string>(
      Array.from(document.querySelectorAll('body *'))
        .filter((element: PageTextElement): boolean =>
          Array.from(element.childNodes).some(
            (node: { readonly nodeType: number; readonly textContent: string | null }): boolean =>
              node.nodeType === textNodeType && (node.textContent ?? '').trim() !== '',
          ),
        )
        .flatMap((element: PageTextElement): readonly string[] => {
          const first: string | undefined = getComputedStyle(element)
            .fontFamily.split(',')
            .map((family: string): string =>
              family
                .trim()
                .replaceAll(/^["']|["']$/gu, '')
                .toLowerCase(),
            )
            .find((family: string): boolean => declared.has(family))
          return first === undefined ? [] : [first]
        }),
    ),
  ]
}

/** The families whose faces to load, and how long the loads may take. */
export interface FontLoad {
  readonly families: readonly string[]
  /** A face still loading when it passes is left for the font rule. */
  readonly budgetMs: number
}

/**
 * Load the faces of the given families that have not loaded yet, within a ceiling. A face already
 * loading is waited for, as `load` answers with the load in flight.
 * @param load the families and the ceiling.
 * @param load.families the families, unquoted and in lower case.
 * @param load.budgetMs how long the loads may take.
 */
export const loadFontFacesInPage = async ({ families, budgetMs }: FontLoad): Promise<void> => {
  // Settled rather than all fulfilled: a face that fails is the font rule's finding.
  const loads: Promise<unknown> = Promise.allSettled(
    Array.from(document.fonts ?? [])
      .filter(
        (face: PageFontFace): boolean =>
          (face.status === 'unloaded' || face.status === 'loading') &&
          families.includes(
            face.family
              .trim()
              .replaceAll(/^["']|["']$/gu, '')
              .toLowerCase(),
          ),
      )
      .map(async (face: PageFontFace): Promise<unknown> => await face.load()),
  )
  await Promise.race([
    loads,
    new Promise<void>((resolve: () => void): void => {
      setTimeout((): void => {
        resolve()
      }, budgetMs)
    }),
  ])
}
