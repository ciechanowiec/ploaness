// The ordered gate registry. The run stops at the first failing gate, so order decides which finding a
// project sees first and is deliberate twice over: the cheap structural checks that tell a project it is
// not wired correctly run before the expensive ones that would otherwise fail confusingly, and the tree
// fingerprint is taken before anything that could rewrite a file and read back after everything has run.
//
// `preflight` and `wiring` lead, and they are the two preconditions: they decide whether ploaness may
// judge this project at all, and whether what it is judging is what it thinks. Past a failing one,
// nothing below means what it says, which is why they stop even a report-only run.

import { assets } from './checks/assets.js'
import { actions, containers, secrets } from './checks/containers.js'
import { conventions } from './checks/conventions.js'
import { dependencyFreshness, licenses, vulnerabilities } from './checks/dependencies.js'
import { editorconfig } from './checks/editorconfig.js'
import { generatedDenial } from './checks/generated.js'
import { commitHistory, linearHistory, requireFullHistory } from './checks/history.js'
import { installScripts } from './checks/install.js'
import { bundle, imageAssets } from './checks/integrity.js'
import { payloadGenerated, payloadRules } from './checks/payload.js'
import { preflight } from './checks/preflight.js'
import { configReferences, documentation, skills } from './checks/references.js'
import { suppressions } from './checks/suppressions.js'
import { build, endToEnd, tests } from './checks/tests.js'
import {
  architecture,
  biome,
  biomeSchema,
  css,
  eslint,
  knip,
  typeCoverage,
  types,
} from './checks/toolchain.js'
import { treeSnapshot, treeVerify } from './checks/tree.js'
import { wiring } from './checks/wiring.js'
import type { Context } from './context.js'
import type { GateResult } from './exec.js'

/** One verification gate. */
export interface Gate {
  /** Stable identifier, usable with `ploaness gate <id>`. */
  readonly id: string
  /** What the gate is checking, shown in the run log. */
  readonly title: string
  /** True when the gate belongs to extended verification only. */
  readonly isExtended: boolean
  /**
   * True when a failure here makes every later gate meaningless rather than merely unreported, which is
   * what stops even a report-only run. `preflight` decides whether ploaness may judge this project at
   * all, and `wiring` decides whether it is judging the project ploaness thinks it is. Past a failing
   * `wiring` the toolchain, the configurations, and the pinned versions are no longer the ones ploaness
   * vouches for, so a survey of findings below it would be a list of verdicts about nothing.
   */
  readonly isPrecondition?: boolean
  readonly run: (context: Context) => GateResult | Promise<GateResult>
}

/** Default verification: the gates that run on every invocation. */
const DEFAULT_GATES: readonly Gate[] = [
  {
    id: 'preflight',
    title: 'supported Payload project',
    isExtended: false,
    isPrecondition: true,
    run: preflight,
  },
  { id: 'wiring', title: 'harness wiring', isExtended: false, isPrecondition: true, run: wiring },
  { id: 'assets', title: 'managed files', isExtended: false, run: assets },
  { id: 'tree-snapshot', title: 'working-tree fingerprint', isExtended: false, run: treeSnapshot },
  { id: 'types', title: 'strict type check', isExtended: false, run: types },
  { id: 'biome', title: 'formatting and fast lint', isExtended: false, run: biome },
  { id: 'biome-schema', title: 'Biome schema drift', isExtended: false, run: biomeSchema },
  { id: 'eslint', title: 'type-aware lint', isExtended: false, run: eslint },
  { id: 'conventions', title: 'source conventions', isExtended: false, run: conventions },
  { id: 'editorconfig', title: 'committed formatting', isExtended: false, run: editorconfig },
  { id: 'suppressions', title: 'suppression ceiling', isExtended: false, run: suppressions },
  { id: 'css', title: 'style sheets', isExtended: false, run: css },
  { id: 'arch', title: 'module architecture', isExtended: false, run: architecture },
  { id: 'type-coverage', title: 'type coverage', isExtended: false, run: typeCoverage },
  {
    id: 'payload-generated',
    title: 'generated Payload artefacts',
    isExtended: false,
    run: payloadGenerated,
  },
  {
    id: 'generated-denial',
    title: 'generated files denied',
    isExtended: false,
    run: generatedDenial,
  },
  { id: 'payload-rules', title: 'Payload usage rules', isExtended: false, run: payloadRules },
  { id: 'config-refs', title: 'config references', isExtended: false, run: configReferences },
  { id: 'secrets', title: 'secret scan', isExtended: false, run: secrets },
  { id: 'licenses', title: 'dependency licenses', isExtended: false, run: licenses },
  {
    id: 'vulnerabilities',
    title: 'known vulnerabilities',
    isExtended: false,
    run: vulnerabilities,
  },
  {
    id: 'install-scripts',
    title: 'install-script allowlist',
    isExtended: false,
    run: installScripts,
  },
  { id: 'deps', title: 'dependency freshness', isExtended: false, run: dependencyFreshness },
  { id: 'image-assets', title: 'image integrity', isExtended: false, run: imageAssets },
  {
    id: 'docs',
    title: 'agent documentation references',
    isExtended: false,
    // The gate identifiers are supplied as reserved words: documenting a gate must not be read as a
    // reference to a script that no longer exists, since the two share a vocabulary. ALL_GATES is read
    // when the gate runs, by which point this module has finished initialising.
    run: (context: Context): GateResult =>
      documentation(context, new Set(ALL_GATES.map((gate: Gate): string => gate.id))),
  },
  { id: 'skills', title: 'agent skill manifests', isExtended: false, run: skills },
  { id: 'docker', title: 'container definitions', isExtended: false, run: containers },
  { id: 'actions', title: 'workflow definitions', isExtended: false, run: actions },
  { id: 'knip', title: 'dead code and unused dependencies', isExtended: false, run: knip },
  { id: 'tests', title: 'suite and coverage', isExtended: false, run: tests },
  { id: 'tree-verify', title: 'working tree unchanged', isExtended: false, run: treeVerify },
]

/** Extended verification adds history, build, bundle, and end-to-end checks. */
const EXTENDED_GATES: readonly Gate[] = [
  {
    id: 'require-full-history',
    title: 'full history present',
    isExtended: true,
    run: requireFullHistory,
  },
  {
    id: 'commit-history',
    title: 'commit messages across the whole history',
    isExtended: true,
    run: (context: Context): GateResult => commitHistory(context, ['HEAD']),
  },
  { id: 'linear-history', title: 'linear history', isExtended: true, run: linearHistory },
  { id: 'build', title: 'production build', isExtended: true, run: build },
  { id: 'bundle', title: 'client bundle budget', isExtended: true, run: bundle },
  { id: 'e2e', title: 'end-to-end suite', isExtended: true, run: endToEnd },
]

/** Every gate ploaness knows, in run order. */
export const ALL_GATES: readonly Gate[] = [...DEFAULT_GATES, ...EXTENDED_GATES]

/**
 * The gates for one verification mode. Extended verification includes Default verification: the extra
 * gates are added rather than substituted, so `--extended` is never a different verdict about less.
 */
export const gatesFor = (isExtended: boolean): readonly Gate[] =>
  isExtended ? ALL_GATES : DEFAULT_GATES

/** Look up one gate by identifier. */
export const gateById = (id: string): Gate | undefined =>
  ALL_GATES.find((gate: Gate): boolean => gate.id === id)
