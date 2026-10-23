import { describe, expect, it } from 'vitest'
import {
  cloudFrontFunctionsIn,
  findCloudFrontRuntimeViolations,
  resolveModulePath,
} from '../src/cloudfront-functions.js'
import type { RuntimeRole } from '../src/javascript-runtimes.js'
import type { TerraformViolation } from '../src/terraform-policy.js'

// HCL's own interpolation, spelled so it is not read as a misplaced template hole.
const DOLLAR: string = '$'
const HOLE: string = `${DOLLAR}{`
const MODULE: string = `${HOLE}path.module}`

const SOURCE: string = 'infra/cdn.tf'
const DEPLOYED: string = 'infra/edge/viewer-request.cjs'
const TRACKED: ReadonlySet<string> = new Set<string>([SOURCE, DEPLOYED])

const functionWith = (runtime: string, code: string): string =>
  [
    'resource "aws_cloudfront_function" "viewer_request" {',
    '  name    = "viewer-request"',
    runtime,
    '  publish = true',
    code,
    '}',
    '',
    'resource "aws_cloudfront_distribution" "site" {',
    '  enabled = true',
    '}',
  ].join('\n')

const RUNTIME: string = '  runtime = "cloudfront-js-2.0"'
const CODE: string = `  code    = file("${MODULE}/edge/viewer-request.cjs")`
const DEPLOYMENT: string = functionWith(RUNTIME, CODE)

const declared = (runtime: RuntimeRole['runtime']): readonly RuntimeRole[] => [
  { role: String.raw`^infra/edge/viewer-request\.cjs$`, runtime },
]

const reasonsOf = (text: string, roles: readonly RuntimeRole[] = declared('cloudfront-js-2.0')): readonly string[] =>
  findCloudFrontRuntimeViolations(SOURCE, text, TRACKED, roles).map(
    (violation: TerraformViolation): string => violation.reason,
  )

describe('resolveModulePath', () => {
  it('resolves against the directory of the source that declares the function', () => {
    expect(resolveModulePath('infra/cdn.tf', 'edge/viewer-request.cjs')).toBe(DEPLOYED)
    expect(resolveModulePath('infra/cdn/main.tf', '../edge/./viewer-request.cjs')).toBe(DEPLOYED)
    expect(resolveModulePath('main.tf', 'edge/viewer-request.cjs')).toBe('edge/viewer-request.cjs')
  })

  it('refuses a path that climbs out of the repository', () => {
    expect(resolveModulePath('main.tf', '../edge/viewer-request.cjs')).toBeUndefined()
    expect(resolveModulePath('infra/main.tf', '..')).toBeUndefined()
  })
})

describe('cloudFrontFunctionsIn', () => {
  it('reads the runtime and the deployed file, and stops at the next block', () => {
    expect(cloudFrontFunctionsIn(SOURCE, DEPLOYMENT)).toEqual([
      { line: 1, runtime: 'cloudfront-js-2.0', code: DEPLOYED },
    ])
  })

  it('reads a block left open at the end of the source', () => {
    expect(cloudFrontFunctionsIn(SOURCE, [DEPLOYMENT.split('\n', 1)[0], RUNTIME, CODE].join('\n'))).toEqual([
      { line: 1, runtime: 'cloudfront-js-2.0', code: DEPLOYED },
    ])
  })

  it('ignores a resource that is commented out', () => {
    expect(cloudFrontFunctionsIn(SOURCE, `# ${DEPLOYMENT.replaceAll('\n', '\n# ')}`)).toEqual([])
  })
})

describe('findCloudFrontRuntimeViolations', () => {
  it('accepts a function whose file is allowlisted for the runtime that deploys it', () => {
    expect(reasonsOf(DEPLOYMENT)).toEqual([])
  })

  it('reports a deployed file declared as Node.js', () => {
    expect(reasonsOf(DEPLOYMENT, declared('node'))).toEqual([
      `this CloudFront function deploys ${DEPLOYED}, which javascriptAllowlist declares as runtime node - ` +
        'declare "runtime": "cloudfront-js-2.0" so it is linted for the engine that runs it',
    ])
  })

  it('reports a deployed file two entries disagree about', () => {
    const roles: readonly RuntimeRole[] = [
      ...declared('cloudfront-js-2.0'),
      { role: String.raw`\.cjs$`, runtime: 'node' },
    ]
    expect(reasonsOf(DEPLOYMENT, roles)[0]).toContain('declares as runtime node and cloudfront-js-2.0')
  })

  it('reports a deployed file no entry admits', () => {
    expect(reasonsOf(DEPLOYMENT, [])[0]).toContain('which no javascriptAllowlist entry admits')
  })

  it('reports a deployed file the repository does not track, such as a build output', () => {
    const built: string = functionWith(RUNTIME, `  code = file("${MODULE}/dist/viewer-request.js")`)
    expect(reasonsOf(built)[0]).toContain('deploys infra/dist/viewer-request.js, which the repository does not track')
  })

  it.each([
    ['a template', `  code = templatefile("${MODULE}/edge/viewer-request.cjs", {})`],
    ['a variable', '  code = var.viewer_request_code'],
    ['a path relative to where OpenTofu runs', '  code = file("edge/viewer-request.cjs")'],
    ['a heredoc', '  code = <<-EOT'],
    ['no code argument', ''],
  ])('refuses to guess the file deployed through %s', (_: string, code: string) => {
    expect(reasonsOf(functionWith(RUNTIME, code))).toEqual([
      'cannot tell which file this CloudFront function deploys - load a tracked, allowlisted file with ' +
        `code = file("${MODULE}/<path>")`,
    ])
  })

  it('reports a function that leaves AWS to choose its runtime', () => {
    expect(reasonsOf(functionWith('', CODE))[0]).toContain('declares no literal runtime, so AWS runs cloudfront-js-1.0')
  })

  it('reports a function that names a runtime the harness does not lint for', () => {
    expect(reasonsOf(functionWith('  runtime = "cloudfront-js-1.0"', CODE))[0]).toContain(
      'runs runtime cloudfront-js-1.0',
    )
  })

  it('reports a runtime that arrives through a variable', () => {
    expect(reasonsOf(functionWith('  runtime = var.runtime', CODE))[0]).toContain('declares no literal runtime')
  })
})
