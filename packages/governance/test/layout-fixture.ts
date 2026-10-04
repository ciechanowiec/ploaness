// The page a layout spec judges, built from the numbers a real page produces: whole CSS pixels and
// computed style strings. Shared by the specs of the layout rules, so each states only its own cases.
import { findLayoutDefects, LAYOUT_MINIMUM_GAP, type LayoutViewport } from '../src/layout-defects.js'
import type { LayoutBorder, LayoutNode, LayoutRect, LayoutSnapshot } from '../src/layout-snapshot.js'

export const TRANSPARENT: string = 'rgba(0, 0, 0, 0)'
export const WHITE: string = 'rgb(255, 255, 255)'
export const TINT: string = 'rgb(236, 253, 245)'
export const RED: string = 'rgb(220, 38, 38)'

export const NO_BORDER: LayoutBorder = { width: 0, style: 'none', color: 'rgb(0, 0, 0)' }
export const GREEN_BORDER: LayoutBorder = { width: 4, style: 'solid', color: 'rgb(22, 163, 74)' }

export const rect = (left: number, top: number, right: number, bottom: number): LayoutRect => ({
  left,
  top,
  right,
  bottom,
})

export const nodeOf = (fields: Partial<LayoutNode> & Pick<LayoutNode, 'index' | 'parent'>): LayoutNode => ({
  label: `div#n${String(fields.index)}`,
  tag: 'div',
  rects: [],
  textRects: [],
  lineHeight: 0,
  text: '',
  display: 'block',
  visibility: 'visible',
  position: 'static',
  backgroundColor: TRANSPARENT,
  backgroundImage: 'none',
  boxShadow: 'none',
  borders: { top: NO_BORDER, right: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER },
  isAriaHidden: false,
  isClipped: false,
  overflowX: 'visible',
  overflowY: 'visible',
  textOverflow: 'clip',
  lineClamp: 'none',
  scrollWidth: 0,
  clientWidth: 0,
  scrollHeight: 0,
  clientHeight: 0,
  title: '',
  ariaLabel: '',
  exemption: undefined,
  exemptionReason: '',
  ...fields,
})

const PHONE: LayoutViewport = { width: 390, height: 844 }

export const snapshotOf = (nodes: readonly LayoutNode[], viewport: LayoutViewport = PHONE): LayoutSnapshot => ({
  route: '/en/account/verify',
  viewportWidth: viewport.width,
  viewportHeight: viewport.height,
  scrollWidth: viewport.width,
  rootBackground: WHITE,
  nodes,
})

export const defectsOf = (nodes: readonly LayoutNode[], minimumGap: number = LAYOUT_MINIMUM_GAP): readonly string[] =>
  findLayoutDefects([snapshotOf(nodes)], minimumGap)

// Tall enough for every page the specs build; only its width, the phone's, decides anything.
const BODY_HEIGHT: number = 300

export const BODY: LayoutNode = nodeOf({
  index: 0,
  parent: -1,
  tag: 'body',
  rects: [rect(0, 0, PHONE.width, BODY_HEIGHT)],
})
