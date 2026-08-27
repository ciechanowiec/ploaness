// The ordered gate registry. The run stops at the first failing gate, so order decides which finding a
// project sees first and is deliberate twice over: the cheap structural checks that tell a project it is
// not wired correctly run before the expensive ones that would otherwise fail confusingly, and the tree
// fingerprint is taken before anything that could rewrite a file and read back after everything has run
// - in extended verification too, which is where the gate most needs to look and where it used to run
// before the build rather than after it.
//
// `preflight` and `wiring` lead, and they are the two preconditions: they decide whether ploaness may
// judge this project at all, and whether what it is judging is what it thinks. Past a failing one,
// nothing below means what it says, which is why they stop even a report-only run.

import {
  type GateDescriptor,
  type MemberDescriptor,
  type PlanStep,
  planSteps,
} from '@ploaness/governance'
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
import { tailwindTokens } from './checks/tailwind.js'
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
import type { Member, Repository as Repo } from './context.js'
import type { GateResult } from './exec.js'

/** What every gate declares, whatever it judges. */
interface GateMeta {
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
      readonly run: (repo: Repo) => GateResult | Promise<GateResult>
    })
  | (GateMeta & {
      readonly scope: 'package' | 'payload'
      readonly run: (member: Member) => GateResult | Promise<GateResult>
    })

/** Default verification: the gates that run on every invocation. */
const DEFAULT_GATES: readonly Gate[] = [
  {
    id: 'preflight',
    scope: 'repository',
    title: 'supported Payload project',
    isExtended: false,
    isPrecondition: true,
    run: preflight,
  },
  {
    id: 'wiring',
    scope: 'repository',
    title: 'harness wiring',
    isExtended: false,
    isPrecondition: true,
    run: wiring,
  },
  { id: 'assets', scope: 'repository', title: 'managed files', isExtended: false, run: assets },
  {
    id: 'tree-snapshot',
    scope: 'repository',
    title: 'working-tree fingerprint',
    isExtended: false,
    run: treeSnapshot,
  },
  { id: 'types', scope: 'package', title: 'strict type check', isExtended: false, run: types },
  {
    id: 'biome',
    scope: 'package',
    title: 'formatting and fast lint',
    isExtended: false,
    run: biome,
  },
  {
    id: 'biome-schema',
    scope: 'repository',
    title: 'Biome schema drift',
    isExtended: false,
    run: biomeSchema,
  },
  { id: 'eslint', scope: 'package', title: 'type-aware lint', isExtended: false, run: eslint },
  {
    id: 'conventions',
    scope: 'repository',
    title: 'source conventions',
    isExtended: false,
    run: conventions,
  },
  {
    id: 'editorconfig',
    scope: 'repository',
    title: 'committed formatting',
    isExtended: false,
    run: editorconfig,
  },
  {
    id: 'suppressions',
    scope: 'package',
    title: 'suppression ceiling',
    isExtended: false,
    run: suppressions,
  },
  { id: 'css', scope: 'package', title: 'style sheets', isExtended: false, run: css },
  {
    id: 'tailwind-tokens',
    scope: 'package',
    title: 'token-bound Tailwind values',
    isExtended: false,
    run: tailwindTokens,
  },
  {
    id: 'arch',
    scope: 'package',
    title: 'module architecture',
    isExtended: false,
    run: architecture,
  },
  {
    id: 'type-coverage',
    scope: 'package',
    title: 'type coverage',
    isExtended: false,
    run: typeCoverage,
  },
  {
    id: 'payload-generated',
    scope: 'payload',
    title: 'generated Payload artefacts',
    isExtended: false,
    run: payloadGenerated,
  },
  {
    id: 'generated-denial',
    scope: 'repository',
    title: 'generated files denied',
    isExtended: false,
    run: generatedDenial,
  },
  {
    id: 'payload-rules',
    // Package rather than payload scope: the import rule inside it is about the language, and holding
    // it here meant it ran only where Payload did.
    scope: 'package',
    title: 'source usage rules',
    isExtended: false,
    run: payloadRules,
  },
  {
    id: 'config-refs',
    scope: 'package',
    title: 'config references',
    isExtended: false,
    run: configReferences,
  },
  { id: 'secrets', scope: 'repository', title: 'secret scan', isExtended: false, run: secrets },
  {
    id: 'licenses',
    scope: 'repository',
    title: 'dependency licenses',
    isExtended: false,
    run: licenses,
  },
  {
    id: 'vulnerabilities',
    scope: 'repository',
    title: 'known vulnerabilities',
    isExtended: false,
    run: vulnerabilities,
  },
  {
    id: 'install-scripts',
    scope: 'repository',
    title: 'install-script allowlist',
    isExtended: false,
    run: installScripts,
  },
  {
    id: 'deps',
    scope: 'repository',
    title: 'dependency freshness',
    isExtended: false,
    run: dependencyFreshness,
  },
  {
    id: 'image-assets',
    scope: 'repository',
    title: 'image integrity',
    isExtended: false,
    run: imageAssets,
  },
  {
    id: 'docs',
    scope: 'repository',
    title: 'agent documentation references',
    isExtended: false,
    // The gate identifiers are supplied as reserved words: documenting a gate must not be read as a
    // reference to a script that no longer exists, since the two share a vocabulary. ALL_GATES is read
    // when the gate runs, by which point this module has finished initialising.
    run: (repository: Repo): GateResult =>
      documentation(repository, new Set(ALL_GATES.map((gate: Gate): string => gate.id))),
  },
  {
    id: 'skills',
    scope: 'repository',
    title: 'agent skill manifests',
    isExtended: false,
    run: skills,
  },
  {
    id: 'docker',
    scope: 'repository',
    title: 'container definitions',
    isExtended: false,
    run: containers,
  },
  {
    id: 'actions',
    scope: 'repository',
    title: 'workflow definitions',
    isExtended: false,
    run: actions,
  },
  {
    id: 'knip',
    scope: 'package',
    title: 'dead code and unused dependencies',
    isExtended: false,
    run: knip,
  },
  { id: 'tests', scope: 'package', title: 'suite and coverage', isExtended: false, run: tests },
]

/** Extended verification adds history, build, bundle, and end-to-end checks. */
const EXTENDED_GATES: readonly Gate[] = [
  {
    id: 'require-full-history',
    scope: 'repository',
    title: 'full history present',
    isExtended: true,
    run: requireFullHistory,
  },
  {
    id: 'commit-history',
    scope: 'repository',
    title: 'commit messages across the whole history',
    isExtended: true,
    run: commitHistory,
  },
  {
    id: 'linear-history',
    scope: 'repository',
    title: 'linear history',
    isExtended: true,
    run: linearHistory,
  },
  { id: 'build', scope: 'package', title: 'production build', isExtended: true, run: build },
  { id: 'bundle', scope: 'package', title: 'client bundle budget', isExtended: true, run: bundle },
  { id: 'e2e', scope: 'package', title: 'end-to-end suite', isExtended: true, run: endToEnd },
]

// Last in BOTH modes, which it was not. It closed `DEFAULT_GATES`, and the extended gates were appended
// after it - so `build`, `bundle`, and `e2e` all ran once the fingerprint had already been compared.
// `next build` rewriting a tracked file is exactly what this gate exists to catch, and extended
// verification was the one mode that could not see it.
const TREE_VERIFY: Gate = {
  id: 'tree-verify',
  scope: 'repository',
  title: 'working tree unchanged',
  isExtended: false,
  run: treeVerify,
}

/** Every gate ploaness knows, in run order. */
export const ALL_GATES: readonly Gate[] = [...DEFAULT_GATES, ...EXTENDED_GATES, TREE_VERIFY]

/**
 * The gates for one verification mode. Extended verification includes Default verification: the extra
 * gates are added rather than substituted, so `--extended` is never a different verdict about less.
 */
export const gatesFor = (isExtended: boolean): readonly Gate[] =>
  isExtended ? ALL_GATES : [...DEFAULT_GATES, TREE_VERIFY]

/** Look up one gate by identifier. */
export const gateById = (id: string): Gate | undefined =>
  ALL_GATES.find((gate: Gate): boolean => gate.id === id)

/** One gate invocation: the gate, and the member it is about when it has one. */
export interface PlannedGate {
  readonly gate: Gate
  readonly member: Member | undefined
}

const describe = (gate: Gate): GateDescriptor => ({
  id: gate.id,
  scope: gate.scope,
  isExtended: gate.isExtended,
})

/**
 * Expand the registry into the invocations one run performs against this repository.
 *
 * The ordering rule itself lives in governance, where it is spec'd against the sequence that shipped
 * before members existed; this only zips that plan back onto the registry entries and the member
 * objects the gates are actually handed.
 * @param repository the repository being judged.
 * @param isExtended whether extended verification's gates are included.
 * @returns one planned invocation per step, in run order.
 */
export const planFor = (repository: Repo, isExtended: boolean): readonly PlannedGate[] => {
  const members: readonly MemberDescriptor[] = repository.members.map(
    (member: Member): MemberDescriptor => ({ path: member.path, isPayload: member.isPayload }),
  )
  return planSteps(
    ALL_GATES.map((gate: Gate): GateDescriptor => describe(gate)),
    members,
    isExtended,
  ).flatMap((step: PlanStep): readonly PlannedGate[] => {
    const gate: Gate | undefined = gateById(step.gateId)
    if (gate === undefined) {
      return []
    }
    return [
      {
        gate,
        member: repository.members.find(
          (candidate: Member): boolean => candidate.path === step.member,
        ),
      },
    ]
  })
}
