// The ESLint configuration for a member that serves no application.
//
// It composes the same blocks the Payload configuration does, minus the ones keyed to paths only a
// Payload application has - the generated mount under `src/app/(payload)`, the collection-config ban,
// the centralised environment module. Those are not relaxations a library is being granted; they are
// carve-outs for files it does not contain, and applying them would have it judged against a layout it
// never claimed. Every cap, ban and suppression rule in `eslint-core.ts` still applies in full.
import { REEXPORT_CONFIG_FILES } from '@ploaness/governance'
import {
  baseLayers,
  compose,
  type FlatConfigBlock,
  guidelineRules,
  immutabilityBlock,
  javascriptBlock,
  prettierLast,
  testIdiomRules,
  testIntegrityRules,
  testSuiteSyntaxRules,
  typeAwareParsing,
  vitestPlugin,
} from './eslint-core.js'

const IGNORED: readonly string[] = ['dist/**', 'node_modules/**', 'coverage/**', '.next/**']

/** The JavaScript a library may legitimately carry: its own flat ESLint config, and nothing else. */
const JAVASCRIPT_FILES: readonly string[] = ['eslint.config.mjs']

// `unicorn/prefer-export-from` rewrites `import x from 'y'` + `export default x` into
// `export { default } from 'y'` - and it AUTOFIXES, so `ploaness format` turned a correctly wired
// project into one the `wiring` gate then rejected, every time it ran. Two rules this harness owns,
// contradicting each other, with the formatter casting the deciding vote.
//
// The paths come from `REEXPORT_CONFIG_FILES`, declared beside the rule that requires the shape, so
// this exemption cannot fall out of step with what `wiring` asks for.
const reexportConfigBlock: FlatConfigBlock = {
  files: [...REEXPORT_CONFIG_FILES],
  rules: { 'unicorn/prefer-export-from': 'off' },
}

export default compose(
  { ignores: [...IGNORED] },
  ...baseLayers,
  typeAwareParsing({ projectService: true }),
  { rules: { ...guidelineRules } } satisfies FlatConfigBlock,
  // Immutability applies to every hand-written module. A library has no generated files to exempt, so
  // the block is applied without the Payload carve-outs rather than with an empty list of them.
  immutabilityBlock(['**/*.ts', '**/*.mts'], []),
  javascriptBlock(JAVASCRIPT_FILES),
  // A library's specs are held to the same integrity rules as an application's: the suite is a gate, so
  // a test that cannot fail is a gate that cannot fail.
  //
  // The plugin is mounted here rather than spread as an entry of its own. A plugin is not a config
  // block - ESLint rejects the whole config on the `meta` key it carries - and it belongs in the block
  // that states the rules naming it, so the two cannot be separated by an edit.
  //
  // All three tables are the shared ones. This block used to carry the integrity rules alone, which read
  // as complete and was not: a library's specs were held to the bare-number ban a Payload consumer's
  // specs are exempt from, and guarded by two of the nineteen selectors rather than all of them. Neither
  // gap is about serving an application, which is the only thing this config is meant to differ about.
  {
    files: ['tests/**'],
    plugins: { vitest: vitestPlugin },
    rules: {
      ...testIdiomRules,
      ...testIntegrityRules,
      ...testSuiteSyntaxRules,
    },
  } satisfies FlatConfigBlock,
  reexportConfigBlock,
  prettierLast,
)
