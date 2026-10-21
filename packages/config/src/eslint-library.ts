// The ESLint configuration for a member that serves no application.
//
// It composes the same blocks the Payload configuration does, minus the ones keyed to paths only a
// Payload application has - the generated mount under `src/app/(payload)`, the collection-config ban,
// the centralised environment module. Those are not relaxations a library is being granted; they are
// carve-outs for files it does not contain, and applying them would have it judged against a layout it
// never claimed. Every cap, ban and suppression rule in `eslint-core.ts` still applies in full.
import { JAVASCRIPT_EXTENSIONS, REEXPORT_CONFIG_FILES, TYPESCRIPT_SOURCE_EXTENSIONS } from '@ploaness/governance'
import {
  allowlistedJavaScript,
  baseLayers,
  commonJavaScriptBlock,
  commonTypeScriptBlock,
  compose,
  type FlatConfigBlock,
  guidelineRules,
  immutabilityBlock,
  javascriptBlock,
  prettierLast,
  processConfigBlock,
  specEnvironmentBlock,
  testIdiomRules,
  testIntegrityRules,
  testSuiteSyntaxRules,
  typeAwareParsing,
  vitestPlugin,
} from './eslint-core.js'
import { projectDirectory, projectSettings as settings } from './project-settings.js'

const IGNORED: readonly string[] = ['dist/**', 'node_modules/**', 'coverage/**', '.next/**']

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

const config: ReturnType<typeof compose> = compose(
  { ignores: [...IGNORED, ...settings.generatedArtefacts] },
  {
    files: [...TYPESCRIPT_SOURCE_EXTENSIONS, ...JAVASCRIPT_EXTENSIONS].map(
      (extension: string): string => `**/*${extension}`,
    ),
  },
  ...baseLayers,
  typeAwareParsing({ projectService: true }),
  { rules: { ...guidelineRules } } satisfies FlatConfigBlock,
  // Every authored module format has the same mutation policy. Generated artifacts are globally
  // ignored, and declared framework glue retains its role-specific allowance.
  immutabilityBlock(
    TYPESCRIPT_SOURCE_EXTENSIONS.map((extension: string): string => `**/*${extension}`),
    settings.frameworkGlue,
  ),

  // The setup file's role, straight after the block it narrows. It must come later: a block that sets
  // this rule replaces its options, so stating the role first would have the general block undo it.
  processConfigBlock(),
  // And the spec's, which is to vary the environment rather than to fix it. Same ordering constraint.
  specEnvironmentBlock(),
  // The JavaScript a library may carry is what its allowlist admits, its own flat ESLint config among
  // the defaults, so the file the conventions gate lets be JavaScript is linted as JavaScript here.
  javascriptBlock([allowlistedJavaScript(settings.javascriptAllowlist, projectDirectory)]),
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
  commonJavaScriptBlock(settings.javascriptAllowlist, projectDirectory),
  commonTypeScriptBlock(),
  prettierLast,
)

export default config
