// The Vitest values the shipped config and the ploaness repository's own config both need.
//
// The sibling of eslint-core.js, and it exists for the same reason: two configs that must agree about a
// literal will not stay in agreement, and the seed below is exactly the kind of literal that drifts
// silently because nothing fails when it does.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROJECT_SETUP_FILE as PROJECT_SETUP_FILE_NAME } from '@ploaness/governance'

/**
 * The sequence block both Vitest configs declare, named so each carries the same shape rather than a
 * structural type inferred separately at two call sites.
 */
export interface DeterministicSequence {
  readonly shuffle: { readonly files: boolean; readonly tests: boolean }
  readonly seed: number
  readonly concurrent: boolean
  readonly hooks: 'stack'
  readonly setupFiles: 'list'
}

/**
 * The setup file a project writes for itself, if it wants one, as this config must spell it.
 *
 * The name comes from governance rather than from a second literal here: the Biome block requires this
 * file, the ESLint config exempts it from a rule aimed at code rather than at process configuration, and
 * this config loads it. Three tools agreeing about one filename is a joint, not a coincidence.
 */
const PROJECT_SETUP_FILE: string = `./${PROJECT_SETUP_FILE_NAME}`

/**
 * The per-file coverage floor every governed member is held to.
 *
 * Declared here because two runner configurations now read it, and a floor written twice is a floor
 * that will eventually differ between the members of one repository.
 */
export const COVERAGE_THRESHOLD: number = 80

/**
 * The fixed fast-check seed the property specs are written against.
 *
 * It carries no meaning. What matters is that it never changes, so a failing property is reproducible by
 * rerunning rather than by guessing which inputs the last run happened to draw.
 */
export const PROPERTY_TEST_SEED: number = 1_734_000_000

// The order a shuffled suite runs in. It is fixed for the same reason the seed above is: a check has one
// verdict on an unchanged repository, and Vitest's own default here is the wall clock, which would make
// the suite report differently on two runs of the same tree. One fixed seed samples one order rather
// than proving independence of all of them - but it is an order other than the one the files happen to
// be written in, which is the coupling that actually accumulates.
const TEST_ORDER_SEED: number = 1_734_000_002

/**
 * The absolute path of the setup file that installs the harness guards.
 *
 * Absolute rather than a bare specifier: under pnpm's strict layout a consuming project cannot resolve
 * `@ploaness/config` at all, but this module knows where it itself lives.
 * @returns the path, for a Vitest `setupFiles` entry.
 */
export const harnessSetupFile = (): string =>
  fileURLToPath(new URL('vitest-setup.js', import.meta.url))

/**
 * The project's own setup file, listed only when the project wrote one.
 *
 * It was listed unconditionally, and nothing wrote it: `ploaness init` scaffolds five stubs and this was
 * not among them, so a freshly initialised project met a Vite resolve error out of the `tests` gate
 * rather than a finding. Whether a project registers matchers of its own is the project's business, so
 * the entry is a fact ploaness reads rather than a file ploaness demands.
 * @returns a one-entry list, or an empty one.
 */
export const projectSetupFiles = (): readonly string[] =>
  existsSync(path.join(process.cwd(), PROJECT_SETUP_FILE)) ? [PROJECT_SETUP_FILE] : []

/**
 * How the suite is ordered, which is the check for the rule that a test reaches its verdict whatever
 * order the suite runs in. A test that only passes in declaration order is passing on an accident of
 * file layout, and shuffling is what turns that accident into a finding.
 */
export const DETERMINISTIC_SEQUENCE: DeterministicSequence = Object.freeze({
  shuffle: Object.freeze({ files: true, tests: true }),
  seed: TEST_ORDER_SEED,
  // A concurrent test interleaves with its neighbours, which is order-dependence rather than
  // independence of order: it makes the coupling harder to see instead of impossible to have.
  concurrent: false,
  // Stated rather than inherited. A default can move between releases; a declaration cannot.
  hooks: 'stack',
  // The harness setup file installs the network guard, and it has to be in place before any project
  // setup runs. Vitest's default here loads setup files in parallel, which would make that a race.
  setupFiles: 'list',
})

/**
 * One entry of a reporter list, spelled as the literals Vitest's own option type accepts.
 *
 * That type takes a reporter NAME or a `[name, options]` tuple, both as literal types - a widened
 * `string` satisfies neither, so a list inferred from an array literal would not be assignable at
 * either call site. Naming the shape once is what lets both configs read the same value.
 */
export type ReporterEntry = 'default' | ['github-actions', { jobSummary: { enabled: false } }]

/**
 * The reporters a run inside GitHub Actions declares.
 *
 * Vitest appends its own `github-actions` reporter whenever `GITHUB_ACTIONS` is set AND no reporter is
 * declared, and that reporter writes a "Vitest Test Report" scoreboard into the workflow's job summary.
 * A verification is a sequence of suites, several of which are MEANT to fail - `it/` drives a fixture
 * whose network guard has to block a remote connection, and asserts that it did - so the summary
 * reported failures at the top of a green run, with nothing beside them to say they were the expected
 * ones. The verdict is the run's exit status; a second scoreboard that contradicts it teaches a reader
 * to trust neither.
 *
 * Only the summary goes. `displayAnnotations` is left at its default, which marks a failing test on the
 * line that failed rather than on the run's front page - and is the half of this reporter that says
 * something the exit status does not.
 */
export const GITHUB_ACTIONS_REPORTERS: readonly ReporterEntry[] = [
  'default',
  ['github-actions', { jobSummary: { enabled: false } }],
]

/**
 * The reporters both Vitest configs declare.
 *
 * The branch mirrors the condition Vitest itself applies rather than declaring the reporter
 * unconditionally: outside a workflow there is no job summary and no annotation surface, so the
 * `::error` lines would land in a local terminal as noise nothing reads.
 * @returns the list, for a Vitest `reporters` entry.
 */
export const testReporters = (): readonly ReporterEntry[] =>
  process.env['GITHUB_ACTIONS'] === 'true' ? GITHUB_ACTIONS_REPORTERS : ['default']
