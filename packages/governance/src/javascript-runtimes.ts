// The engine each allowlisted JavaScript file runs in, as its allowlist entry declares it.
//
// A file admitted by `javascriptAllowlist` is not necessarily a Node.js program. A CloudFront Function is
// loaded by OpenTofu as written and run by AWS's own engine, which rejects syntax Node.js accepts, so the
// lint rules and the infrastructure check both need the engine. Nothing in the file says which one it is,
// so the entry has to: there is no default, because a silent Node.js default is how such a file passes
// every gate and then fails every request.
import { matchesRole, type RolePattern } from './file-roles.js'

/** The engines an allowlisted file may declare, in the order a finding lists them. */
export const JAVASCRIPT_RUNTIMES: readonly ['node', 'cloudfront-js-2.0'] = ['node', 'cloudfront-js-2.0']

/** One engine an allowlisted file runs in. */
export type JavascriptRuntime = (typeof JAVASCRIPT_RUNTIMES)[number]

/** The runtime of CloudFront Functions, named once for the lint block and the infrastructure check. */
export const CLOUDFRONT_RUNTIME: JavascriptRuntime = 'cloudfront-js-2.0'

/** An allowlist role together with the engine its files run in. */
export interface RuntimeRole {
  readonly role: RolePattern
  readonly runtime: JavascriptRuntime
}

/**
 * Decide whether a declared value names an engine this harness lints for.
 * @param value the `runtime` an allowlist entry declared.
 * @returns true for a known runtime.
 */
export const isJavascriptRuntime = (value: unknown): value is JavascriptRuntime => RUNTIME_VALUES.includes(value)

// Widened, so a value of any type can be looked up without asserting it is a runtime first.
const RUNTIME_VALUES: readonly unknown[] = JAVASCRIPT_RUNTIMES

/**
 * The roles whose files run in one engine.
 * @param roles every allowlist role with its runtime.
 * @param runtime the engine to select.
 * @returns the role patterns declaring that engine.
 */
export const rolesFor = (roles: readonly RuntimeRole[], runtime: JavascriptRuntime): readonly RolePattern[] =>
  roles
    .filter((entry: RuntimeRole): boolean => entry.runtime === runtime)
    .map((entry: RuntimeRole): RolePattern => entry.role)

/**
 * Every engine the entries matching a file declare for it.
 *
 * More than one means two entries disagree about the same file, which a caller must treat as a defect
 * rather than pick between.
 * @param file the repo-relative path.
 * @param roles every allowlist role with its runtime.
 * @returns each declared runtime once, in catalogue order.
 */
export const runtimesOf = (file: string, roles: readonly RuntimeRole[]): readonly JavascriptRuntime[] =>
  JAVASCRIPT_RUNTIMES.filter((runtime: JavascriptRuntime): boolean => matchesRole(file, rolesFor(roles, runtime)))
