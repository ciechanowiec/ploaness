// The two facts the shipped accessibility sweep cannot know about the project it runs in.
//
// The sweep itself is a managed file, byte-identical in every consumer, so this module is the whole of
// its configuration surface. Both entries are one-directional: a project may add a route prefix the
// crawl must not follow and may lower the route ceiling, and can do neither in the other direction.
import { projectSettings } from './project-settings.js'

export const SKIPPED_ROUTE_PREFIXES: readonly string[] = projectSettings.accessibilitySkipRoutes

export const MAX_SWEEP_ROUTES: number = projectSettings.accessibilityRouteBudget
