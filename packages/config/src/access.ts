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
//
// The other fact the sweep needs is which reported fields hold no data. `/api/access` cannot say: a
// `type: 'ui'` field is reported exactly as a real column is, and no rule can be written against one.
// Only the BUILT configuration can tell them apart, so it is imported here - the same way the
// `payload-defaults` probe imports it, and for the same reason, that the configuration Payload boots is
// the only place the answer exists. Reading it is filesystem work, which is why it sits in this package
// rather than in the dependency-free judging layer.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  type DatalessFields,
  datalessFieldsIn,
  type PublicAccess,
  parseJsonc,
  payloadConfigPathOf,
  readKey,
} from '@ploaness/governance'
import { projectSettings } from './project-settings.js'

export {
  type AccessReport,
  type DatalessFields,
  staleDeclarations,
  undeclaredGrants,
} from '@ploaness/governance'

export const PUBLIC_ACCESS: readonly PublicAccess[] = projectSettings.publicAccess

/**
 * Every field path the project's Payload configuration reports but stores nothing behind.
 *
 * Resolved from the working directory, which in the Playwright worker is the project root: the
 * `@payload-config` alias in the project tsconfig names the file, and the environment the configuration
 * validates at module scope has already been loaded by the shipped Playwright config.
 *
 * A configuration that cannot be read or imported yields nothing, which judges every reported path and
 * so errs on the side of more findings rather than fewer - the sweep is a security boundary, and a
 * failure here must never quietly widen it. It is also not this sweep's report to make: `payload-defaults`
 * boots the same configuration and names an unbuildable one far better than a browser test could.
 * @returns the dataless paths of each entity that has any, keyed by slug; empty when unreadable.
 */
export const datalessFields = async (): Promise<DatalessFields> => {
  try {
    const root: string = process.cwd()
    const tsconfig: unknown = parseJsonc(
      readFileSync(path.join(root, 'tsconfig.json'), 'utf8'),
    ).value
    const configFile: string = path.join(root, payloadConfigPathOf(tsconfig))
    const configModule: unknown = await import(pathToFileURL(configFile).href)
    // Awaited either way: `buildConfig` returns a promise, and a plain object is read the same.
    return datalessFieldsIn(await readKey(configModule, 'default'))
  } catch {
    return {}
  }
}
