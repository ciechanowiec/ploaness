// The ordered gate registry. Order is deliberate: the cheap structural checks that tell a project it is
// not wired correctly run before the expensive ones that would otherwise fail confusingly, and the tree
// fingerprint is taken before anything that could rewrite a file and read back after everything has run.

import { assets } from './checks/assets.js'
import { actions, containers, prose, secrets } from './checks/containers.js'
import { conventions } from './checks/conventions.js'
import { dependencyFreshness, licenses } from './checks/dependencies.js'
import { commitHistory, linearHistory, requireFullHistory } from './checks/history.js'
import { bundle, imageAssets } from './checks/integrity.js'
import { payloadGenerated, payloadRules } from './checks/payload.js'
import { preflight } from './checks/preflight.js'
import { configReferences, documentation, skills } from './checks/references.js'
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
  readonly extended: boolean
  readonly run: (context: Context) => GateResult | Promise<GateResult>
}

/** Default verification: the gates that run on every invocation. */
const DEFAULT_GATES: readonly Gate[] = [
  { id: 'preflight', title: 'supported Payload project', extended: false, run: preflight },
  { id: 'wiring', title: 'harness wiring', extended: false, run: wiring },
  { id: 'assets', title: 'managed files', extended: false, run: assets },
  { id: 'tree-snapshot', title: 'working-tree fingerprint', extended: false, run: treeSnapshot },
  { id: 'types', title: 'strict type check', extended: false, run: types },
  { id: 'biome', title: 'formatting and fast lint', extended: false, run: biome },
  { id: 'biome-schema', title: 'Biome schema drift', extended: false, run: biomeSchema },
  { id: 'eslint', title: 'type-aware lint', extended: false, run: eslint },
  { id: 'conventions', title: 'source conventions', extended: false, run: conventions },
  { id: 'css', title: 'style sheets', extended: false, run: css },
  { id: 'arch', title: 'module architecture', extended: false, run: architecture },
  { id: 'type-coverage', title: 'type coverage', extended: false, run: typeCoverage },
  {
    id: 'payload-generated',
    title: 'generated Payload artefacts',
    extended: false,
    run: payloadGenerated,
  },
  { id: 'payload-rules', title: 'Payload usage rules', extended: false, run: payloadRules },
  { id: 'config-refs', title: 'config references', extended: false, run: configReferences },
  { id: 'secrets', title: 'secret scan', extended: false, run: secrets },
  { id: 'licenses', title: 'dependency licenses', extended: false, run: licenses },
  { id: 'deps', title: 'dependency freshness', extended: false, run: dependencyFreshness },
  { id: 'image-assets', title: 'image integrity', extended: false, run: imageAssets },
  {
    id: 'docs',
    title: 'agent documentation references',
    extended: false,
    // The gate identifiers are supplied as reserved words: documenting a gate must not be read as a
    // reference to a script that no longer exists, since the two share a vocabulary. ALL_GATES is read
    // when the gate runs, by which point this module has finished initialising.
    run: (context: Context): GateResult =>
      documentation(context, new Set(ALL_GATES.map((gate: Gate): string => gate.id))),
  },
  { id: 'prose', title: 'README prose', extended: false, run: prose },
  { id: 'skills', title: 'agent skill manifests', extended: false, run: skills },
  { id: 'docker', title: 'container definitions', extended: false, run: containers },
  { id: 'actions', title: 'workflow definitions', extended: false, run: actions },
  { id: 'knip', title: 'dead code and unused dependencies', extended: false, run: knip },
  { id: 'tests', title: 'suite and coverage', extended: false, run: tests },
  { id: 'tree-verify', title: 'working tree unchanged', extended: false, run: treeVerify },
]

/** Extended verification adds history, build, bundle, and end-to-end checks. */
const EXTENDED_GATES: readonly Gate[] = [
  {
    id: 'require-full-history',
    title: 'full history present',
    extended: true,
    run: requireFullHistory,
  },
  {
    id: 'commit-history',
    title: 'commit messages across the whole history',
    extended: true,
    run: (context: Context): GateResult => commitHistory(context, ['HEAD']),
  },
  { id: 'linear-history', title: 'linear history', extended: true, run: linearHistory },
  { id: 'build', title: 'production build', extended: true, run: build },
  { id: 'bundle', title: 'client bundle budget', extended: true, run: bundle },
  { id: 'e2e', title: 'end-to-end suite', extended: true, run: endToEnd },
]

/** Every gate ploaness knows, in run order. */
export const ALL_GATES: readonly Gate[] = [...DEFAULT_GATES, ...EXTENDED_GATES]

/**
 * The gates for one verification mode. Extended verification includes Default verification: the extra
 * gates are added rather than substituted, so `--extended` is never a different verdict about less.
 */
export const gatesFor = (extended: boolean): readonly Gate[] =>
  extended ? ALL_GATES : DEFAULT_GATES

/** Look up one gate by identifier. */
export const gateById = (id: string): Gate | undefined =>
  ALL_GATES.find((gate: Gate): boolean => gate.id === id)
