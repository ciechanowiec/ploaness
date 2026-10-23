// Tie each CloudFront Function an OpenTofu or Terraform source deploys to the allowlist entry that lints it.
//
// The lint rules for a CloudFront Function apply only to a file whose allowlist entry declares the
// CloudFront runtime, and nothing in the file itself says which engine runs it. The resource that
// deploys it does say so. Reading the two together means a file that CloudFront runs cannot be declared
// a Node.js program by mistake. A `code` argument this reader cannot follow fails, rather than being
// skipped, because a skipped function is deployed with nothing having linted it.
import { CLOUDFRONT_RUNTIME, type RuntimeRole, runtimesOf } from './javascript-runtimes.js'
import { stripComments } from './source-text.js'
import { type ResourceBlock, resourceBlocksIn } from './terraform-blocks.js'
import type { TerraformViolation } from './terraform-policy.js'

const FUNCTION_TYPE: string = 'aws_cloudfront_function'

// HCL's own interpolation, spelled so it is not read as a misplaced template hole.
const DOLLAR: string = '$'
const HOLE: string = `${DOLLAR}{`
const MODULE_DIRECTORY: string = `${HOLE}path.module}`
const RULE: string = 'cloudfront-runtime'

// The one spelling followed: the module's own directory plus a literal path. A bare relative path is
// resolved against the directory OpenTofu runs in, which a source does not state, and every other form
// is an expression or a built artefact this reader cannot evaluate.
const MODULE_FILE: RegExp = /^[ \t]*code[ \t]*=[ \t]*file\([ \t]*"\$\{path\.module\}\/(?<path>[^"$]+)"[ \t]*\)[ \t]*$/
const CODE_ARGUMENT: RegExp = /^[ \t]*code[ \t]*=/
const LITERAL_RUNTIME: RegExp = /^[ \t]*runtime[ \t]*=[ \t]*"(?<runtime>[^"$]*)"[ \t]*$/

/** One CloudFront Function a source deploys, as far as a line reader can follow it. */
export interface CloudFrontFunction {
  readonly line: number
  /** The literal runtime, or undefined when the argument is absent or an expression. */
  readonly runtime: string | undefined
  /** The repo-relative file it deploys, or undefined when `code` is anything this reader cannot follow. */
  readonly code: string | undefined
}

const directoryOf = (file: string): string => file.slice(0, Math.max(0, file.lastIndexOf('/')))

const PARENT: string = '..'

// Undefined once a `..` climbs above the repository, which no tracked file can sit at.
const normalisedSegments = (segments: readonly string[]): readonly string[] | undefined =>
  segments.reduce<readonly string[] | undefined>((resolved: readonly string[] | undefined, segment: string) => {
    if (resolved === undefined || segment === '.' || segment === '') {
      return resolved
    }
    if (segment !== PARENT) {
      return [...resolved, segment]
    }
    return resolved.length === 0 ? undefined : resolved.slice(0, -1)
  }, [])

/**
 * The repo-relative path `file("${path.module}/<relative>")` names, read from a source at `source`.
 * @param source the repo-relative path of the source that declares the function.
 * @param relative the path written after `${path.module}/`.
 * @returns the resolved path, or undefined when it climbs out of the repository.
 */
export const resolveModulePath = (source: string, relative: string): string | undefined => {
  const directory: string = directoryOf(source)
  const segments: readonly string[] | undefined = normalisedSegments([
    ...(directory.length === 0 ? [] : directory.split('/')),
    ...relative.split('/'),
  ])
  return segments === undefined || segments.length === 0 ? undefined : segments.join('/')
}

const codeOf = (source: string, body: readonly string[]): string | undefined => {
  const line: string | undefined = body.find((candidate: string): boolean => CODE_ARGUMENT.test(candidate))
  const relative: string | undefined = line === undefined ? undefined : MODULE_FILE.exec(line)?.groups?.['path']
  return relative === undefined ? undefined : resolveModulePath(source, relative)
}

const runtimeOf = (body: readonly string[]): string | undefined =>
  body
    .map((line: string): string | undefined => LITERAL_RUNTIME.exec(line)?.groups?.['runtime'])
    .find((runtime: string | undefined): boolean => runtime !== undefined)

/**
 * Every CloudFront Function a source declares.
 * @param source the repo-relative path of the source, which `${path.module}` resolves against.
 * @param text the source's text, as tracked.
 * @returns one function per resource block, in source order.
 */
export const cloudFrontFunctionsIn = (source: string, text: string): readonly CloudFrontFunction[] =>
  resourceBlocksIn(stripComments(text).split('\n'), FUNCTION_TYPE).map(
    (block: ResourceBlock): CloudFrontFunction => ({
      line: block.line,
      runtime: runtimeOf(block.body),
      code: codeOf(source, block.body),
    }),
  )

const violation = (line: number, reason: string): TerraformViolation => ({ line, rule: RULE, reason })

const runtimeViolations = (deployed: CloudFrontFunction): readonly TerraformViolation[] => {
  if (deployed.runtime === CLOUDFRONT_RUNTIME) {
    return []
  }
  const stated: string =
    deployed.runtime === undefined
      ? 'declares no literal runtime, so AWS runs cloudfront-js-1.0'
      : `runs runtime ${deployed.runtime}`
  return [
    violation(
      deployed.line,
      `this CloudFront function ${stated}, which this harness does not lint for - ` +
        `set runtime = "${CLOUDFRONT_RUNTIME}"`,
    ),
  ]
}

const allowlistViolations = (
  deployed: CloudFrontFunction,
  file: string,
  roles: readonly RuntimeRole[],
): readonly TerraformViolation[] => {
  const declared: readonly string[] = runtimesOf(file, roles)
  if (declared.length === 0) {
    return [
      violation(
        deployed.line,
        `this CloudFront function deploys ${file}, which no javascriptAllowlist entry admits - ` +
          `add one declaring "runtime": "${CLOUDFRONT_RUNTIME}"`,
      ),
    ]
  }
  return declared.some((runtime: string): boolean => runtime !== CLOUDFRONT_RUNTIME)
    ? [
        violation(
          deployed.line,
          `this CloudFront function deploys ${file}, which javascriptAllowlist declares as runtime ` +
            `${declared.join(' and ')} - declare "runtime": "${CLOUDFRONT_RUNTIME}" so it is linted for ` +
            'the engine that runs it',
        ),
      ]
    : []
}

const codeViolations = (
  deployed: CloudFrontFunction,
  tracked: ReadonlySet<string>,
  roles: readonly RuntimeRole[],
): readonly TerraformViolation[] => {
  if (deployed.code === undefined) {
    return [
      violation(
        deployed.line,
        'cannot tell which file this CloudFront function deploys - load a tracked, allowlisted file with ' +
          `code = file("${MODULE_DIRECTORY}/<path>")`,
      ),
    ]
  }
  if (!tracked.has(deployed.code)) {
    return [
      violation(
        deployed.line,
        `this CloudFront function deploys ${deployed.code}, which the repository does not track - deploy ` +
          'a tracked file, so the file that runs is the file that is linted',
      ),
    ]
  }
  return allowlistViolations(deployed, deployed.code, roles)
}

/**
 * Report every CloudFront Function whose deployed file is not linted for the runtime that runs it.
 * @param source the repo-relative path of the source.
 * @param text the source's text, as tracked.
 * @param tracked the repo-relative paths of the tracked files.
 * @param roles every allowlist role with the runtime it declares.
 * @returns one violation per defect, ordered by the line it sits on.
 */
export const findCloudFrontRuntimeViolations = (
  source: string,
  text: string,
  tracked: ReadonlySet<string>,
  roles: readonly RuntimeRole[],
): readonly TerraformViolation[] =>
  cloudFrontFunctionsIn(source, text).flatMap((deployed: CloudFrontFunction): readonly TerraformViolation[] => [
    ...runtimeViolations(deployed),
    ...codeViolations(deployed, tracked, roles),
  ])
