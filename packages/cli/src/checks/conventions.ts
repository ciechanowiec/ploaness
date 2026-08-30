// Source conventions: the AI-typography ban and the preference for TypeScript over hand-written
// JavaScript. Both are scanned across every file in the working tree rather than a chosen subtree,
// because the
// characters a model emits appear in documentation and configuration as readily as in code.
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  DOCUMENTED_EXTENSIONS,
  type DocBlock,
  findOrphanedDocBlocks,
  findTypographyViolations,
  hasExtension,
  isBinary,
  matchesRole,
  type TypographyViolation,
} from '@ploaness/governance'
import { type Context, workingTreeFiles } from '../context.js'
import { failed, type GateResult, passed } from '../exec.js'

// The typography ban used to carry an allowlist of ten extensions here, which is the wrong shape for a
// rule that reaches "every file the repository does not exclude by file role": `.css`, `.adoc`,
// a shell script, and a Dockerfile all went unscanned, and every new text format arrived unscanned
// until someone remembered this list. The role predicate is default-safe in the other direction - a
// binary asset is recognised from its own bytes, and everything else is text that gets scanned.
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
const blankVendorRegions = (text: string): string =>
  VENDOR_MANAGED_REGIONS.reduce(
    (content: string, region: RegExp): string =>
      content.replaceAll(region, (match: string): string => match.replaceAll(/[^\n]/g, ' ')),
    text,
  )

const typographyFindings = (context: Context, tracked: readonly string[]): readonly string[] =>
  tracked
    .filter((file: string): boolean => !matchesRole(file, context.settings.typographyExclusions))
    .flatMap((file: string): readonly string[] => {
      const bytes: Buffer = readFileSync(path.join(context.root, file))
      if (isBinary(bytes)) {
        return []
      }
      const content: string = blankVendorRegions(bytes.toString('utf8'))
      return findTypographyViolations(content).map(
        (violation: TypographyViolation): string =>
          `${file}:${String(violation.line)}:${String(violation.column)} ` +
          `banned ${violation.label}; use ${violation.replacement}`,
      )
    })

const javascriptFindings = (context: Context, tracked: readonly string[]): readonly string[] =>
  tracked
    .filter(
      (file: string): boolean =>
        hasExtension(file, JAVASCRIPT_EXTENSIONS) &&
        !matchesRole(file, context.settings.javascriptAllowlist),
    )
    .map(
      (file: string): string =>
        `${file} hand-written JavaScript is banned; write TypeScript instead`,
    )

// A documenting comment stranded above another one documents nothing, and the symbol it was written
// for is left with no doc at all. It is scanned here rather than by the lint pass because
// eslint-plugin-jsdoc structurally cannot see it: every rule that plugin ships visits the block
// ATTACHED to a syntax node, and the parser hands a declaration only the LAST block before it.
//
// The role exclusions are the ones `isGovernedCode` already reads, which is how the suppressions gate
// scopes the same question: a generated file carries comments its generator wrote, and a project
// cannot be asked to repair them.
const orphanedDocFindings = (context: Context, tracked: readonly string[]): readonly string[] =>
  tracked
    .filter(
      (file: string): boolean =>
        hasExtension(file, DOCUMENTED_EXTENSIONS) &&
        !matchesRole(file, context.settings.typographyExclusions),
    )
    .flatMap((file: string): readonly string[] => {
      const content: string = readFileSync(path.join(context.root, file), 'utf8')
      return findOrphanedDocBlocks(content).map(
        (block: DocBlock): string =>
          `${file}:${String(block.line)} the doc block ending on line ${String(block.endLine)} ` +
          `is followed by another doc block rather than by what it documents`,
      )
    })

// An enumerated path is not always a regular file. `git ls-files` reports a symlink and a submodule
// gitlink too, and reading either throws rather than yielding text.
const isRegularFile = (root: string, file: string): boolean => {
  const full: string = path.join(root, file)
  return existsSync(full) && statSync(full).isFile()
}

/**
 * Scan every file in the working tree for banned typography, stray hand-written JavaScript, and
 * documenting
 * comments left above another comment rather than above what they document.
 */
export const conventions = (context: Context): GateResult => {
  const tracked: readonly string[] = workingTreeFiles(context.root).filter(
    (file: string): boolean => isRegularFile(context.root, file),
  )
  const findings: readonly string[] = [
    ...typographyFindings(context, tracked),
    ...javascriptFindings(context, tracked),
    ...orphanedDocFindings(context, tracked),
  ]
  return findings.length > 0
    ? failed(`${String(findings.length)} convention violation(s)`, findings)
    : passed(`${String(tracked.length)} working-tree file(s) follow the source conventions`)
}
