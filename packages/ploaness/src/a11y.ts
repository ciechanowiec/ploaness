// See eslint.js for why every entry point is re-exported through this package.

export type {
  AxeResults,
  HitTargetClassification,
  HitTargetProbe,
  HitTargetVerdict,
} from '@ploaness/config/a11y'
export {
  classifyHitTarget,
  expectNoAxeDefects,
  expectNoLayoutDefects,
  expectSweptPage,
  findDefiniteIncomplete,
  LAYOUT_SCAN_VIEWPORTS,
  layoutDefectsOf,
  MAX_SWEEP_ROUTES,
  SKIPPED_ROUTE_PREFIXES,
  scopedAxe,
  settleForScan,
  unsweptRoutes,
} from '@ploaness/config/a11y'
