// The one fact the shipped access-boundary sweep cannot know about the project it runs in, and the
// decision it makes about what the running application answered.
//
// The sweep itself is a managed file, byte-identical in every consumer, so this module is the whole of
// its configuration surface. It cannot loosen the sweep in the way an exclusion loosens a gate: every
// entry names one permission the project grants on purpose and says why, and the sweep still reports
// every other anonymous permission it finds. A project that declares nothing is judged most strictly.
//
// The verdict travels with the setting because the sweep is a spec no unit test can reach: what it does
// with Payload's answer is decided in `access-boundary.ts` and re-exported here, leaving the spec
// holding the HTTP call and the assertion.
import type { PublicAccess } from '@ploaness/governance'
import { projectSettings } from './project-settings.js'

export { type AccessReport, undeclaredGrants } from '@ploaness/governance'

export const PUBLIC_ACCESS: readonly PublicAccess[] = projectSettings.publicAccess
