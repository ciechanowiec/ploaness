// What the shipped accessibility sweep cannot know about the project it runs in, and the two decisions
// it must not make for itself.
//
// The sweep is a managed file, byte-identical in every consumer, so this module is the whole of its
// configuration surface. The first two entries are one-directional: a project may add a route prefix
// the crawl must not follow and may lower the route ceiling, and can do neither in the other
// direction.
//
// The last two are not configuration at all. They are rules, so they live in `@ploaness/governance`
// where a spec exercises them against captured axe output and against probe shapes no browser has to
// produce on demand, and they are re-exported here because the sweep imports through one entry point.

export type {
  HitTargetClassification,
  HitTargetProbe,
  HitTargetVerdict,
} from '@ploaness/governance'
export { classifyHitTarget, findDefiniteIncomplete } from '@ploaness/governance'

import { projectSettings } from './project-settings.js'

export const SKIPPED_ROUTE_PREFIXES: readonly string[] = projectSettings.accessibilitySkipRoutes

export const MAX_SWEEP_ROUTES: number = projectSettings.accessibilityRouteBudget
