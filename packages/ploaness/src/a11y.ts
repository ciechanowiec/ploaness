// See eslint.js for why every entry point is re-exported through this package.

export type {
  HitTargetClassification,
  HitTargetProbe,
  HitTargetVerdict,
} from '@ploaness/config/a11y'
export {
  classifyHitTarget,
  findDefiniteIncomplete,
  MAX_SWEEP_ROUTES,
  SKIPPED_ROUTE_PREFIXES,
  settleForScan,
  unsweptRoutes,
} from '@ploaness/config/a11y'
