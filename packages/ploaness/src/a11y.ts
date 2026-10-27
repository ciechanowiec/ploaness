// See eslint.js for why every entry point is re-exported through this package.

export type {
  AxeResults,
  HitTargetClassification,
  HitTargetProbe,
  HitTargetVerdict,
  SettleOutcome,
} from '@ploaness/config/a11y'
export {
  classifyHitTarget,
  expectNoAxeDefects,
  expectNoLayoutDefects,
  expectPerceivable,
  expectSweptPage,
  findDefiniteIncomplete,
  isSkippedSweepRoute,
  LAYOUT_SCAN_VIEWPORTS,
  layoutDefectsOf,
  MAX_SWEEP_ROUTES,
  SKIPPED_ROUTE_PREFIXES,
  scopedAxe,
  settleForScan,
  unsweptRoutes,
} from '@ploaness/config/a11y'
