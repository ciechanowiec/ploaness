// Source conventions: the AI-typography ban and the preference for TypeScript over hand-written
// JavaScript. Both are scanned across every tracked file rather than a chosen subtree, because the
// characters a model emits appear in documentation and configuration as readily as in code.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { findTypographyViolations, type TypographyViolation } from '@ploaness/governance'
import { type Context, trackedFiles } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

const TYPOGRAPHY_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
  '.js',
  '.md',
  '.json',
  '.yml',
  '.yaml',
]

const JAVASCRIPT_EXTENSIONS: readonly string[] = ['.js', '.mjs', '.cjs']

// Regions a tool rewrites byte for byte on every run, so a local edit is reverted rather than kept and
// the ban has nothing to enforce against. `next dev` upserts its agent-rules block into AGENTS.md
// whenever it detects an AI agent, em dashes included. Only the span between the markers is skipped;
// every line the project itself authors in the same file is still scanned.
const VENDOR_MANAGED_REGIONS: readonly RegExp[] = [
  /<!-- BEGIN:nextjs-agent-rules -->.*?<!-- END:nextjs-agent-rules -->/gs,
]

// Blank a managed region to spaces rather than delete it, so the line and column numbers reported for
// the rest of the file still point at real source positions.
const blankVendorRegions = (text: string): string => {
  let content: string = text
  for (const region of VENDOR_MANAGED_REGIONS) {
    content = content.replaceAll(region, (match: string): string => match.replaceAll(/[^\n]/g, ' '))
  }
  return content
}

const endsWithAny = (file: string, extensions: readonly string[]): boolean =>
  extensions.some((extension: string): boolean => file.endsWith(extension))

const matchesAny = (file: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern: string): boolean => new RegExp(pattern).test(file))

const typographyFindings = (context: Context, tracked: readonly string[]): readonly string[] =>
  tracked
    .filter(
      (file: string): boolean =>
        endsWithAny(file, TYPOGRAPHY_EXTENSIONS) &&
        !matchesAny(file, context.settings.typographyExclusions),
    )
    .flatMap((file: string): readonly string[] => {
      const content: string = blankVendorRegions(
        readFileSync(path.join(context.root, file), 'utf8'),
      )
      return findTypographyViolations(content).map(
        (violation: TypographyViolation): string =>
          `${file}:${violation.line}:${violation.column} banned ${violation.label}; use ${violation.replacement}`,
      )
    })

const javascriptFindings = (context: Context, tracked: readonly string[]): readonly string[] =>
  tracked
    .filter(
      (file: string): boolean =>
        endsWithAny(file, JAVASCRIPT_EXTENSIONS) &&
        !matchesAny(file, context.settings.javascriptAllowlist),
    )
    .map(
      (file: string): string =>
        `${file} hand-written JavaScript is banned; write TypeScript instead`,
    )

/** Scan every tracked file for banned typography and stray hand-written JavaScript. */
export const conventions = (context: Context): GateResult => {
  const tracked: readonly string[] = trackedFiles(context.root).filter((file: string): boolean =>
    existsSync(path.join(context.root, file)),
  )
  const findings: readonly string[] = [
    ...typographyFindings(context, tracked),
    ...javascriptFindings(context, tracked),
  ]
  return findings.length > 0
    ? failed(`${findings.length} convention violation(s)`, findings)
    : passed(`${tracked.length} tracked file(s) follow the source conventions`)
}

/** Report typography findings without the JavaScript rule, used by the commit-message hook path. */
export const typographyOf = (text: string): readonly TypographyViolation[] =>
  findTypographyViolations(text)
