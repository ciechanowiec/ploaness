import { describe, expect, it } from 'vitest'
import type { CandidateFinding } from '../src/browser-exemptions.js'
import {
  contrastRatio,
  type DisclosureProbe,
  disclosureDefects,
  type FocusPosition,
  findDistortedImages,
  findSmallText,
  findUnloadedFonts,
  findUnloadedImages,
  findUnreservedMedia,
  findUpscaledImages,
  hasContrastingFocus,
  hasVisibleFocus,
  instability,
  isFocusBackwards,
  obscuringContent,
} from '../src/browser-rules.js'
import type { FontFaceFacts, LayoutNode, LayoutSnapshot, MediaFacts } from '../src/layout-snapshot.js'
import { BODY, nodeOf, rect, snapshotOf } from './layout-fixture.js'

const messages = (candidates: readonly CandidateFinding[]): readonly string[] =>
  candidates.map((candidate: CandidateFinding): string => `${candidate.rule}: ${candidate.message}`)

const smallTextParagraph = (fontSize: number, fields: Partial<LayoutNode> = {}): LayoutSnapshot =>
  snapshotOf([
    BODY,
    nodeOf({
      index: 1,
      parent: 0,
      tag: 'p',
      label: 'p.note',
      rects: [rect(0, 0, 200, 20)],
      textRects: [rect(0, 0, 120, 14)],
      fontSize,
      ...fields,
    }),
  ])

describe('small text', () => {
  it('fails text below 12 px and passes text at 12 px', () => {
    expect([
      messages(findSmallText(smallTextParagraph(11.5))),
      messages(findSmallText(smallTextParagraph(12))),
    ]).toEqual([['small-text: text rendered at 11.5px, below 12px: p.note'], []])
  })

  it('ignores text nobody sees: visually hidden, hidden from assistive technology, or not rendered', () => {
    expect(
      [
        smallTextParagraph(8, { isClipped: true }),
        smallTextParagraph(8, { isAriaHidden: true }),
        smallTextParagraph(8, { visibility: 'hidden' }),
        smallTextParagraph(8, { textRects: [] }),
      ].flatMap((snapshot: LayoutSnapshot): readonly CandidateFinding[] => findSmallText(snapshot)),
    ).toEqual([])
  })
})

const RASTER: MediaFacts = {
  isComplete: true,
  isVector: false,
  naturalWidth: 800,
  naturalHeight: 600,
  contentWidth: 400,
  contentHeight: 300,
  objectFit: 'fill',
  reservedWidth: 400,
  reservedHeight: 300,
}

const image = (media: Partial<MediaFacts>, fields: Partial<LayoutNode> = {}): LayoutSnapshot =>
  snapshotOf([
    BODY,
    nodeOf({
      index: 1,
      parent: 0,
      tag: 'img',
      label: 'img.hero',
      rects: [rect(0, 0, 400, 300)],
      media: { ...RASTER, ...media },
      ...fields,
    }),
  ])

describe('image rules', () => {
  it('passes an image served at its size, in proportion, with its space reserved', () => {
    const valid: LayoutSnapshot = image({})
    expect([
      ...findUnloadedImages(valid),
      ...findDistortedImages(valid),
      ...findUpscaledImages(valid),
      ...findUnreservedMedia(valid),
    ]).toEqual([])
  })

  it('fails an image that did not load, but not a vector without an intrinsic size', () => {
    expect([
      messages(findUnloadedImages(image({ isComplete: false }))),
      messages(findUnloadedImages(image({ naturalWidth: 0 }))),
      messages(findUnloadedImages(image({ naturalWidth: 0, isVector: true }))),
    ]).toEqual([
      ['image-load: image did not load (complete false, natural width 800): img.hero'],
      ['image-load: image did not load (complete true, natural width 0): img.hero'],
      [],
    ])
  })

  it('fails a stretched image unless object-fit keeps its proportions', () => {
    expect([
      messages(findDistortedImages(image({ contentHeight: 200 }))),
      messages(findDistortedImages(image({ contentHeight: 200, objectFit: 'cover' }))),
      messages(findDistortedImages(image({ contentHeight: 301 }))),
    ]).toEqual([
      ['image-distorted: image rendered at 400x200px from a 800x600px source, out of proportion: img.hero'],
      [],
      [],
    ])
  })

  it('fails an image enlarged by more than 10%, at the scale its object-fit displays it', () => {
    expect([
      messages(findUpscaledImages(image({ naturalWidth: 300, naturalHeight: 225 }))),
      messages(findUpscaledImages(image({ naturalWidth: 370, naturalHeight: 278 }))),
      messages(findUpscaledImages(image({ naturalWidth: 400, naturalHeight: 100, objectFit: 'cover' }))).length,
      messages(findUpscaledImages(image({ naturalWidth: 400, naturalHeight: 100, objectFit: 'contain' }))).length,
      messages(findUpscaledImages(image({ naturalWidth: 100, naturalHeight: 75, objectFit: 'none' }))).length,
      messages(findUpscaledImages(image({ naturalWidth: 100, naturalHeight: 75, objectFit: 'scale-down' }))).length,
    ]).toEqual([
      ['image-upscaled: image source 300x225px displayed at 133% in a 400x300px box; serve a larger source: img.hero'],
      [],
      1,
      0,
      0,
      0,
    ])
  })

  it('fails media that takes a different box once loaded, unless it is out of flow', () => {
    expect([
      messages(findUnreservedMedia(image({ reservedWidth: 400, reservedHeight: 0 }))),
      messages(findUnreservedMedia(image({ reservedHeight: 0 }, { position: 'absolute' }))),
    ]).toEqual([
      [
        'media-space: img reserves 400x0px before loading and takes 400x300px after; give it width and height ' +
          'attributes or an aspect-ratio: img.hero',
      ],
      [],
    ])
  })
})

const fontPage = (
  faces: readonly FontFaceFacts[],
  fontFamily: string = '"Inter", "Inter Fallback", sans-serif',
): LayoutSnapshot => ({
  ...snapshotOf([BODY, nodeOf({ index: 1, parent: 0, textRects: [rect(0, 0, 10, 10)], fontFamily })]),
  fontFaces: faces,
})

const fontFace = (family: string, status: string): FontFaceFacts => ({ family, status, weight: '400', style: 'normal' })

describe('font loading', () => {
  it('passes a used family with a loaded face, and a fallback face the browser never needed', () => {
    expect(
      findUnloadedFonts(
        fontPage([fontFace('Inter', 'loaded'), fontFace('Inter', 'unloaded'), fontFace('Inter Fallback', 'unloaded')]),
      ),
    ).toEqual([])
  })

  it('fails a used face that errored or is still loading, and a used family with no face loaded', () => {
    expect([
      findUnloadedFonts(fontPage([fontFace('Inter', 'loaded'), fontFace('Inter', 'error')])),
      findUnloadedFonts(fontPage([fontFace('Inter', 'unloaded')])),
      findUnloadedFonts(fontPage([fontFace('Inter', 'loading')], 'Georgia, Inter')),
    ]).toEqual([
      ['@font-face "Inter" 400 normal is error after the page settled'],
      ['@font-face "inter" is used by the page\'s text and none of its faces loaded'],
      ['@font-face "Inter" 400 normal is loading after the page settled'],
    ])
  })

  it('ignores a family no text uses', () => {
    expect(findUnloadedFonts(fontPage([fontFace('Display', 'error')], 'system-ui'))).toEqual([])
  })
})

const placed = (top: number, left: number, changes: Partial<FocusPosition> = {}): FocusPosition => ({
  top,
  bottom: top + 40,
  left,
  right: left + 100,
  landmark: 'main',
  isUnplaced: false,
  isRightToLeft: false,
  ...changes,
})

const pixels = (count: number, colour: readonly number[]): readonly number[] =>
  Array.from({ length: count }, (): readonly number[] => colour).flat()

describe('focus and disclosures', () => {
  it('reports a focused element only when every sample of it is covered', () => {
    expect([
      obscuringContent([
        { isCovered: true, coveredBy: 'header.site' },
        { isCovered: true, coveredBy: 'header.site' },
      ]),
      obscuringContent([
        { isCovered: true, coveredBy: 'header.site' },
        { isCovered: false, coveredBy: '' },
      ]),
      obscuringContent([]),
    ]).toEqual(['header.site', undefined, undefined])
  })

  it('reads a focus indicator from any differing pixel', () => {
    expect([
      hasVisibleFocus(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3)),
      hasVisibleFocus(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 9, 3)),
      hasVisibleFocus(Uint8Array.of(1, 2), Uint8Array.of(1, 2, 3)),
    ]).toEqual([false, true, true])
  })

  it('measures the WCAG contrast ratio from either side', () => {
    expect([contrastRatio(1, 0), contrastRatio(0, 1), contrastRatio(0.5, 0.5)]).toEqual([21, 21, 1])
  })

  it('accepts a focus change whose contrasting pixels cover a line along half the longer side', () => {
    const white: readonly number[] = [255, 255, 255, 255]
    const unfocused: readonly number[] = pixels(20, white)
    // Ten of twenty pixels turn dark blue (contrast 8.6:1), the rest stay white.
    const ring: readonly number[] = [...pixels(10, [29, 78, 216, 255]), ...pixels(10, white)]
    // Every pixel turns a pale grey (contrast 1.1:1).
    const tint: readonly number[] = pixels(20, [243, 244, 246, 255])
    expect([
      hasContrastingFocus({ unfocused, focused: ring, scale: 1, extent: 20 }),
      hasContrastingFocus({ unfocused, focused: ring, scale: 1, extent: 21 }),
      hasContrastingFocus({ unfocused, focused: ring, scale: 2, extent: 20 }),
      hasContrastingFocus({ unfocused, focused: tint, scale: 1, extent: 2 }),
    ]).toEqual([true, false, false, false])
  })

  it('reports focus moving entirely above the previous element in the same landmark', () => {
    expect([
      // The next row, and the next control on the same row.
      isFocusBackwards(placed(100, 0), placed(200, 0)),
      isFocusBackwards(placed(100, 0), placed(100, 120)),
      // Back up the page, beside or behind the previous control.
      isFocusBackwards(placed(200, 0), placed(100, 0)),
      isFocusBackwards(placed(200, 120), placed(100, 50)),
      // Overlapping rows are not entirely above.
      isFocusBackwards(placed(200, 0), placed(170, 0)),
    ]).toEqual([false, false, true, true, false])
  })

  it('lets focus climb to the head of the next column, in either direction of text', () => {
    expect([
      isFocusBackwards(placed(400, 0), placed(100, 120)),
      isFocusBackwards(placed(400, 200, { isRightToLeft: true }), placed(100, 50, { isRightToLeft: true })),
      isFocusBackwards(placed(400, 0, { isRightToLeft: true }), placed(100, 120, { isRightToLeft: true })),
    ]).toEqual([false, false, true])
  })

  it('compares positions only within one landmark and only where they mean an order', () => {
    expect([
      isFocusBackwards(placed(900, 0, { landmark: 'footer' }), placed(100, 0)),
      isFocusBackwards(placed(200, 0), placed(100, 0, { isUnplaced: true })),
      isFocusBackwards(placed(200, 0, { isUnplaced: true }), placed(100, 0)),
    ]).toEqual([false, false, false])
  })

  it('holds a popup and a modal dialog to Escape and focus return, and an accordion to neither', () => {
    const probe: DisclosureProbe = {
      wasOpened: true,
      isPopup: true,
      closedOnEscape: true,
      focusReturned: true,
      isModal: false,
      focusTrapped: false,
    }
    expect([
      disclosureDefects(probe),
      disclosureDefects({ ...probe, closedOnEscape: false }),
      disclosureDefects({ ...probe, focusReturned: false }),
      disclosureDefects({ ...probe, isPopup: false, isModal: true }),
      disclosureDefects({ ...probe, isPopup: false, closedOnEscape: false }),
      disclosureDefects({ ...probe, wasOpened: false }),
    ]).toEqual([
      [],
      ['Escape does not close it'],
      ['focus does not return to its control after Escape'],
      ['focus leaves the open modal dialog while tabbing'],
      [],
      ['activation did not open the disclosure'],
    ])
  })
})

const bannerPage = (top: number, extra: readonly LayoutNode[] = []): LayoutSnapshot =>
  snapshotOf([
    BODY,
    nodeOf({ index: 1, parent: 0, label: 'div.banner', rects: [rect(0, top, 100, top + 50)] }),
    ...extra,
  ])

describe('stability', () => {
  it('ignores cleanup of hidden streaming markers without masking visible changes', () => {
    const marker: LayoutNode = nodeOf({ index: 1, parent: 0, label: 'template.pending', rects: [], textRects: [] })
    const content: LayoutNode = nodeOf({ index: 2, parent: 0, label: 'p.content', rects: [rect(0, 10, 100, 30)] })
    const before: LayoutSnapshot = snapshotOf([BODY, marker, content])
    expect(instability(before, snapshotOf([BODY, { ...content, index: 1 }]))).toBeUndefined()
    expect(instability(before, snapshotOf([BODY, { ...content, index: 1, rects: [rect(0, 20, 100, 40)] }]))).toBe(
      'p.content moved between two measurements',
    )
  })

  it('still detects content appearing and text without an element box', () => {
    const hidden: LayoutNode = nodeOf({ index: 2, parent: 0, rects: [], textRects: [] })
    const before: LayoutSnapshot = bannerPage(10, [hidden])
    expect(instability(before, bannerPage(10, [{ ...hidden, rects: [rect(0, 70, 100, 90)] }]))).toBe(
      'the element count changed from 2 to 3',
    )
    expect(instability(before, bannerPage(10, [{ ...hidden, textRects: [rect(0, 70, 100, 90)] }]))).toBe(
      'the element count changed from 2 to 3',
    )
  })

  it('accepts geometry that moved by at most one pixel', () => {
    expect(instability(bannerPage(10), bannerPage(11))).toBeUndefined()
  })

  it('names what moved or what appeared', () => {
    expect([
      instability(bannerPage(10), bannerPage(12)),
      instability(bannerPage(10), bannerPage(10, [nodeOf({ index: 2, parent: 0, rects: [rect(0, 70, 100, 90)] })])),
    ]).toEqual(['div.banner moved between two measurements', 'the element count changed from 2 to 3'])
  })
})
