// Registry order is run order: structural preconditions precede analyzers, and tree verification is last.

import {
  coversLevel,
  type GateDescriptor,
  type MemberDescriptor,
  type PlanStep,
  planSteps,
  type VerificationLevel,
} from '@ploaness/governance'
import { assets } from './checks/assets.js'
import { blocklist } from './checks/blocklist.js'
import { complianceReport } from './checks/compliance-report.js'
import { actions, containers, secrets } from './checks/containers.js'
import { conventions } from './checks/conventions.js'
import { dependencyFreshness, licenses, vulnerabilities } from './checks/dependencies.js'
import { editorconfig } from './checks/editorconfig.js'
import { environment } from './checks/environment.js'
import { generatedDenial } from './checks/generated.js'
import { commitHistory, linearHistory, requireFullHistory } from './checks/history.js'
import { infrastructure } from './checks/infra.js'
import { installScripts, releaseAge } from './checks/install.js'
import { bundle, imageAssets } from './checks/integrity.js'
import { oxlint } from './checks/oxlint.js'
import { adminViews, payloadDefaults, payloadGenerated, payloadRules } from './checks/payload.js'
import { preflight } from './checks/preflight.js'
import { configReferences, documentation, skills } from './checks/references.js'
import { sbomInventory } from './checks/sbom.js'
import { shell } from './checks/shell.js'
import { suppressions } from './checks/suppressions.js'
import { tailwindTokens } from './checks/tailwind.js'
import { build, endToEnd, tests } from './checks/tests.js'
import { architecture, biome, biomeSchema, css, eslint, knip, typeCoverage, types } from './checks/toolchain.js'
import { treeSnapshot, treeVerify } from './checks/tree.js'
import { wiring } from './checks/wiring.js'
import type { GateRun, Member, Repository } from './context.js'
import type { GateResult } from './exec.js'

/** What every gate declares, whatever it judges. */
interface GateMeta {
  /** Stable identifier, usable with `ploaness gate <id>`. */
  readonly id: string
  /** What the gate is checking, shown in the run log. */
  readonly title: string
  /** The lowest verification level that runs the gate. */
  readonly level: VerificationLevel
  /**
   * True when a failure here makes every later gate meaningless rather than merely unreported, which is
   * what stops even a report-only run. `preflight` decides whether ploaness may judge this project at
   * all, and `wiring` decides whether it is judging the project ploaness thinks it is. Past a failing
   * `wiring` the toolchain, the configurations, and the pinned versions are no longer the ones ploaness
   * vouches for, so a survey of findings below it would be a list of verdicts about nothing.
   */
  readonly isPrecondition?: boolean
}

/**
 * One verification gate, discriminated by what it judges.
 *
 * The union is what stops a repository-scope gate being handed a member's directory - the mistake that
 * made `install-scripts` demand a workspace file inside a package, and made the overrides check vouch
 * for pins it had not read. A check written against `Context` still satisfies either arm, because both
 * carry the fields it always used.
 */
export type Gate =
  | (GateMeta & {
      readonly scope: 'repository'
      readonly run: (repository: Repository, run: GateRun) => GateResult | Promise<GateResult>
    })
  | (GateMeta & {
      readonly scope: 'package' | 'payload'
      readonly run: (member: Member, run: GateRun) => GateResult | Promise<GateResult>
    })

/** Quick verification: the static gates that run on every invocation. */
const QUICK_GATES: readonly Gate[] = [
  {
    id: 'preflight',
    scope: 'repository',
    title: 'supported Payload project',
    level: 'quick',
    isPrecondition: true,
    run: preflight,
  },
  {
    id: 'wiring',
    scope: 'repository',
    title: 'harness wiring',
    level: 'quick',
    isPrecondition: true,
    run: wiring,
  },
  { id: 'assets', scope: 'repository', title: 'managed files', level: 'quick', run: assets },
  {
    id: 'tree-snapshot',
    scope: 'repository',
    title: 'working-tree fingerprint',
    level: 'quick',
    run: treeSnapshot,
  },
  { id: 'types', scope: 'package', title: 'strict type check', level: 'quick', run: types },
  {
    id: 'biome',
    scope: 'package',
    title: 'formatting and fast lint',
    level: 'quick',
    run: biome,
  },
  {
    id: 'biome-schema',
    scope: 'repository',
    title: 'Biome schema drift',
    level: 'quick',
    run: biomeSchema,
  },
  {
    id: 'oxlint',
    scope: 'package',
    title: 'Native JavaScript and TypeScript rules',
    level: 'quick',
    run: oxlint,
  },
  { id: 'eslint', scope: 'package', title: 'type-aware lint', level: 'quick', run: eslint },
  {
    id: 'conventions',
    scope: 'repository',
    title: 'source conventions',
    level: 'quick',
    run: conventions,
  },
  {
    id: 'editorconfig',
    scope: 'repository',
    title: 'committed formatting',
    level: 'quick',
    run: editorconfig,
  },
  {
    id: 'suppressions',
    scope: 'package',
    title: 'suppression ceiling',
    level: 'quick',
    run: suppressions,
  },
  { id: 'css', scope: 'package', title: 'style sheets', level: 'quick', run: css },
  {
    id: 'tailwind-tokens',
    scope: 'package',
    title: 'token-bound Tailwind values',
    level: 'quick',
    run: tailwindTokens,
  },
  {
    id: 'arch',
    scope: 'package',
    title: 'module architecture',
    level: 'quick',
    run: architecture,
  },
  {
    id: 'type-coverage',
    scope: 'package',
    title: 'type coverage',
    level: 'quick',
    run: typeCoverage,
  },
  {
    id: 'payload-generated',
    scope: 'payload',
    title: 'generated Payload artefacts',
    level: 'quick',
    run: payloadGenerated,
  },
  {
    // After `payload-generated`, which has just proven the configuration imports through Payload's own
    // CLI, so a failure here is about access rather than about the import.
    id: 'payload-defaults',
    scope: 'payload',
    title: 'access decided in the built configuration',
    level: 'quick',
    run: payloadDefaults,
  },
  {
    id: 'generated-denial',
    scope: 'repository',
    title: 'generated files denied',
    level: 'quick',
    run: generatedDenial,
  },
  {
    id: 'payload-rules',
    // Package rather than payload scope: the import rule inside it is about the language, and holding
    // it here meant it ran only where Payload did.
    scope: 'package',
    title: 'source usage rules',
    level: 'quick',
    run: payloadRules,
  },
  {
    // Payload scope: a custom admin view is a thing only Payload has, and the exemption it hides
    // behind is one ploaness itself writes into the accessibility sweep.
    id: 'admin-views',
    scope: 'payload',
    title: 'custom admin views scanned',
    level: 'quick',
    run: adminViews,
  },
  {
    id: 'config-refs',
    scope: 'package',
    title: 'config references',
    level: 'quick',
    run: configReferences,
  },
  { id: 'secrets', scope: 'repository', title: 'secret scan', level: 'quick', run: secrets },
  {
    id: 'licenses',
    scope: 'repository',
    title: 'dependency licenses',
    level: 'quick',
    run: licenses,
  },
  {
    id: 'vulnerabilities',
    scope: 'repository',
    title: 'known vulnerabilities',
    level: 'quick',
    run: vulnerabilities,
  },
  {
    id: 'install-scripts',
    scope: 'repository',
    title: 'install-script allowlist',
    level: 'quick',
    run: installScripts,
  },
  {
    id: 'release-age',
    scope: 'repository',
    title: 'release-age floor',
    level: 'quick',
    run: releaseAge,
  },
  // Before `deps`, so a refused image or package is named before the freshness report that has to
  // stop short of it.
  {
    id: 'blocklist',
    scope: 'repository',
    title: 'refused images and packages',
    level: 'quick',
    run: blocklist,
  },
  {
    id: 'deps',
    scope: 'repository',
    title: 'dependency freshness',
    level: 'quick',
    run: dependencyFreshness,
  },
  {
    id: 'image-assets',
    scope: 'repository',
    title: 'image integrity',
    level: 'quick',
    run: imageAssets,
  },
  {
    // After `config-refs` and before `docs`, with the other rot gates: the same kind of finding, which
    // is a declaration in one file that another file was supposed to follow and did not.
    id: 'environment',
    scope: 'repository',
    title: 'environment variable coherence',
    level: 'quick',
    run: environment,
  },
  {
    id: 'docs',
    scope: 'repository',
    title: 'agent documentation references',
    level: 'quick',
    // The gate identifiers are supplied as reserved words: documenting a gate must not be read as a
    // reference to a script that no longer exists, since the two share a vocabulary. ALL_GATES is read
    // when the gate runs, by which point this module has finished initialising.
    run: (repository: Repository): GateResult =>
      documentation(repository, new Set(ALL_GATES.map((gate: Gate): string => gate.id))),
  },
  {
    id: 'skills',
    scope: 'repository',
    title: 'agent skill manifests',
    level: 'quick',
    run: skills,
  },
  {
    id: 'docker',
    scope: 'repository',
    title: 'container definitions',
    level: 'quick',
    run: containers,
  },
  {
    id: 'actions',
    scope: 'repository',
    title: 'workflow definitions',
    level: 'quick',
    run: actions,
  },
  {
    id: 'knip',
    scope: 'package',
    title: 'dead code and unused dependencies',
    level: 'quick',
    run: knip,
  },
  { id: 'tests', scope: 'package', title: 'suite and coverage', level: 'quick', run: tests },
]

/**
 * Delta verification adds the shell scripts, the infrastructure definitions, history, build, bundle,
 * end-to-end checks, and a workspace dependency inventory. Full verification runs the same gates; what
 * it adds is the complete browser sweep in every engine.
 */
const DELTA_GATES: readonly Gate[] = [
  // First in the tier because it is the cheapest thing in it: a static read of the tracked scripts,
  // ahead of a production build that takes minutes. A broken deployment script should be reported
  // before the time is spent, not after.
  { id: 'shell', scope: 'repository', title: 'shell scripts', level: 'delta', run: shell },
  {
    id: 'infra',
    scope: 'repository',
    title: 'infrastructure definitions',
    level: 'delta',
    run: infrastructure,
  },
  {
    id: 'require-full-history',
    scope: 'repository',
    title: 'full history present',
    level: 'delta',
    run: requireFullHistory,
  },
  {
    id: 'commit-history',
    scope: 'repository',
    title: 'commit messages across the whole history',
    level: 'delta',
    // Wrapped, because its second parameter is a revision range for the `commit-message` command.
    run: (repository: Repository): GateResult => commitHistory(repository),
  },
  {
    id: 'linear-history',
    scope: 'repository',
    title: 'linear history',
    level: 'delta',
    run: linearHistory,
  },
  { id: 'build', scope: 'package', title: 'production build', level: 'delta', run: build },
  { id: 'bundle', scope: 'package', title: 'client bundle budget', level: 'delta', run: bundle },
  { id: 'e2e', scope: 'package', title: 'end-to-end suite', level: 'delta', run: endToEnd },
  { id: 'sbom', scope: 'repository', title: 'dependency inventory', level: 'delta', run: sbomInventory },
  {
    id: 'compliance-report',
    scope: 'repository',
    title: 'compliance report',
    level: 'delta',
    run: complianceReport,
  },
]

// Last at every level. It once closed the static gates, with the browser-level gates appended after it,
// so `build`, `bundle`, and `e2e` all ran once the fingerprint had already been compared - and `next
// build` rewriting a tracked file is exactly what this gate exists to catch.
const TREE_VERIFY: Gate = {
  id: 'tree-verify',
  scope: 'repository',
  title: 'working tree unchanged',
  level: 'quick',
  run: treeVerify,
}

/** Every gate ploaness knows, in run order. */
export const ALL_GATES: readonly Gate[] = [...QUICK_GATES, ...DELTA_GATES, TREE_VERIFY]

/**
 * The gates for one verification level. Each level includes the one before it: the extra gates are
 * added rather than substituted, so a later level is never a different verdict about less.
 */
export const gatesFor = (level: VerificationLevel): readonly Gate[] =>
  ALL_GATES.filter((gate: Gate): boolean => coversLevel(level, gate.level))

/** Look up one gate by identifier. */
export const gateById = (id: string): Gate | undefined => ALL_GATES.find((gate: Gate): boolean => gate.id === id)

/** One gate invocation: the gate, and the member it is about when it has one. */
export interface PlannedGate {
  readonly gate: Gate
  readonly member: Member | undefined
}

const describe = (gate: Gate): GateDescriptor => ({
  id: gate.id,
  scope: gate.scope,
  level: gate.level,
})

/**
 * Expand the registry into the invocations one run performs against this repository.
 *
 * The ordering rule itself lives in governance, where it is spec'd against the sequence that shipped
 * before members existed; this only zips that plan back onto the registry entries and the member
 * objects the gates are actually handed.
 * @param repository the repository being judged.
 * @param level the level the run was asked for.
 * @returns one planned invocation per step, in run order.
 */
export const planFor = (repository: Repository, level: VerificationLevel): readonly PlannedGate[] => {
  const members: readonly MemberDescriptor[] = repository.members.map(
    (member: Member): MemberDescriptor => ({ path: member.path, isPayload: member.isPayload }),
  )
  return planSteps(
    ALL_GATES.map((gate: Gate): GateDescriptor => describe(gate)),
    members,
    level,
  ).flatMap((step: PlanStep): readonly PlannedGate[] => {
    const gate: Gate | undefined = gateById(step.gateId)
    if (gate === undefined) {
      return []
    }
    return [
      {
        gate,
        member: repository.members.find((candidate: Member): boolean => candidate.path === step.member),
      },
    ]
  })
}
