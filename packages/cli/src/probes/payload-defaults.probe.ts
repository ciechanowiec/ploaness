// The half of the `payload-defaults` gate that runs inside the project: it imports the project's built
// Payload configuration and reports which operations of which entities still carry Payload's own
// `defaultAccess`. It is spawned by the gate through tsx, with the project root as its working directory
// so that `payload` and the configuration's own imports resolve from the project, and it prints one
// marker-prefixed JSON line that the gate parses. What the report MEANS is decided in
// `@ploaness/governance`; this file only reads.
//
// Two arguments, both absolute: the configuration file, and Payload's `dist/auth/defaultAccess.js`.
// Identity is judged by reference first and by source text second, because a loader can register the
// same module twice under two URLs and a project function cannot be byte-identical to Payload's by
// accident. Nothing here imports `payload` by name: the harness never depends on it, and the copy that
// matters is the one the project installed.
import { pathToFileURL } from 'node:url'
import {
  accessOperationsFor,
  INHERITED_ACCESS_REPORT_MARKER,
  type InheritedAccessEntry,
  type InheritedAccessReport,
  isArray,
  type PayloadSubjectKind,
  readKey,
} from '@ploaness/governance'

// node, the probe, then the two paths.
const ARGUMENT_OFFSET: number = 2
const [configFile, defaultAccessFile] = process.argv.slice(ARGUMENT_OFFSET)
if (configFile === undefined || defaultAccessFile === undefined) {
  throw new Error('usage: payload-defaults.probe.js <payload.config.ts> <defaultAccess.js>')
}

const defaultAccessModule: unknown = await import(pathToFileURL(defaultAccessFile).href)
const defaultAccess: unknown = readKey(defaultAccessModule, 'defaultAccess')
if (typeof defaultAccess !== 'function') {
  throw new TypeError(`Payload's default access could not be established from ${defaultAccessFile}`)
}
const defaultAccessSource: string = String(defaultAccess)

// Undeclared counts as inherited, and not only as a convenience. `executeAccess` runs the rule it is
// given and, handed nothing, falls through to `if (req.user) return true` - so a missing rule is not an
// absent permission but an open one, indistinguishable at runtime from Payload's own default. Payload
// fills every operation but `readVersions` in during sanitisation, which is the one this reaches.
const isInherited = (rule: unknown): boolean =>
  rule === undefined ||
  rule === defaultAccess ||
  (typeof rule === 'function' && String(rule) === defaultAccessSource)

const configModule: unknown = await import(pathToFileURL(configFile).href)
// Awaited either way: `buildConfig` returns a promise, and a configuration handed over as a plain
// object is read the same.
const config: unknown = await readKey(configModule, 'default')
const collections: unknown = readKey(config, 'collections')
const globals: unknown = readKey(config, 'globals')
if (!(isArray(collections) && isArray(globals))) {
  throw new Error(`the default export of ${configFile} is not a built Payload configuration`)
}

// Which operations an entity owes depends on what it is, and sanitisation is what makes that legible:
// `auth` survives as an object on an auth collection and as `false` elsewhere, and `versions` survives
// as an object where it is enabled and is deleted where it is not. Both reads are therefore about the
// built object rather than the source the project wrote.
const entryOf = (entity: unknown, kind: PayloadSubjectKind): InheritedAccessEntry => {
  const access: unknown = readKey(entity, 'access')
  const operations: readonly string[] = accessOperationsFor({
    kind,
    hasAuth: Boolean(readKey(entity, 'auth')),
    hasVersions: Boolean(readKey(entity, 'versions')),
  })
  return {
    slug: String(readKey(entity, 'slug')),
    inherited: operations.filter((operation: string): boolean =>
      isInherited(readKey(access, operation)),
    ),
  }
}

const report: InheritedAccessReport = {
  collections: collections.map(
    (collection: unknown): InheritedAccessEntry => entryOf(collection, 'collection'),
  ),
  globals: globals.map((global: unknown): InheritedAccessEntry => entryOf(global, 'global')),
}

process.stdout.write(`${INHERITED_ACCESS_REPORT_MARKER}${JSON.stringify(report)}\n`)
// The exit code rather than `process.exit()`, for the reason bin.ts states: the report is flushed
// before the process ends. A plugin that keeps a handle open after import holds the process until the
// gate's own timeout, which then reports it as a build that did not finish rather than as a pass.
process.exitCode = 0
