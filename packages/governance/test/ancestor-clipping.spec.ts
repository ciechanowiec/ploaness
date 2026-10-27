import { describe, expect, it } from 'vitest'
import type { LayoutNode, LayoutSnapshot } from '../src/layout-snapshot.js'
import { type ClipFinding, findClippedText } from '../src/layout-text.js'
import { nodeOf, rect } from './layout-fixture.js'

const clipped = (parent: Partial<LayoutNode> = {}, child: Partial<LayoutNode> = {}): LayoutSnapshot => ({
  route: '/',
  viewportWidth: 390,
  viewportHeight: 844,
  scrollWidth: 390,
  rootBackground: 'white',
  fontFaces: [],
  nodes: [
    nodeOf({
      index: 0,
      parent: -1,
      rects: [rect(0, 0, 200, 100)],
      overflowY: 'hidden',
      clientWidth: 200,
      clientHeight: 100,
      scrollWidth: 200,
      scrollHeight: 160,
      ...parent,
    }),
    nodeOf({
      index: 1,
      parent: 0,
      tag: 'button',
      label: 'Read more',
      rects: [rect(0, 120, 100, 160)],
      textRects: [rect(8, 130, 90, 150)],
      clientWidth: 100,
      clientHeight: 40,
      ...child,
    }),
  ],
})

describe('text clipped by an ancestor', () => {
  it('reports a button below a parent that hides its overflow', () => {
    const findings: readonly ClipFinding[] = findClippedText(clipped())
    expect(findings.map((finding) => [finding.node.label, finding.clippedBy?.index])).toEqual([['Read more', 0]])
  })
  it('reports partial clipping and horizontal clipping', () => {
    expect(findClippedText(clipped({}, { textRects: [rect(8, 90, 90, 110)] }))).toHaveLength(1)
    expect(findClippedText(clipped({ overflowX: 'clip' }, { textRects: [rect(180, 10, 220, 30)] }))).toHaveLength(1)
  })
  it('accepts visible text and one pixel of rounding', () => {
    expect(findClippedText(clipped({}, { textRects: [rect(8, 10, 90, 30)] }))).toEqual([])
    expect(findClippedText(clipped({}, { textRects: [rect(8, 80, 90, 101)] }))).toEqual([])
  })
  it('accepts scrollable content, inactive slides and visually hidden text', () => {
    expect(findClippedText(clipped({ overflowY: 'auto' }))).toEqual([])
    expect(findClippedText(clipped({ isInert: true }))).toEqual([])
    expect(findClippedText(clipped({ isAriaHidden: true }))).toEqual([])
    expect(findClippedText(clipped({}, { isClipped: true }))).toEqual([])
    expect(findClippedText(clipped({ visibility: 'hidden' }))).toEqual([])
  })
  it('respects containing blocks of absolute and fixed content', () => {
    expect(findClippedText(clipped({}, { position: 'absolute' }))).toEqual([])
    expect(findClippedText(clipped({ position: 'relative' }, { position: 'absolute' }))).toHaveLength(1)
    expect(findClippedText(clipped({}, { position: 'fixed' }))).toEqual([])
  })
  it('keeps labelled line clamps valid', () => {
    expect(findClippedText(clipped({ lineClamp: '2', text: 'Read more', title: 'Read more' }))).toEqual([])
  })
  it('does not blame a hidden outer box for content scrolled out of an inner box', () => {
    const snapshot: LayoutSnapshot = clipped({ overflowY: 'auto' })
    const outer: LayoutNode = nodeOf({ index: 2, parent: -1, rects: [rect(0, 0, 200, 100)], overflowY: 'hidden' })
    const inner: LayoutNode = { ...(snapshot.nodes[0] as LayoutNode), parent: 2 }
    expect(findClippedText({ ...snapshot, nodes: [inner, snapshot.nodes[1] as LayoutNode, outer] })).toEqual([])
  })
})
