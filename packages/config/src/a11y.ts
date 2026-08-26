// The one fact the shipped accessibility sweep cannot know about the project it runs in.
//
// The sweep itself is a managed file, byte-identical in every consumer, so this module is the whole of
// its configuration surface. It is additive by construction: a project may add a route prefix the crawl
// must not follow, and cannot take away the ones every Payload project carries.
import { projectSettings } from './project-settings.js'

export const SKIPPED_ROUTE_PREFIXES: readonly string[] = projectSettings.accessibilitySkipRoutes
