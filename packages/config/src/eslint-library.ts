// The ESLint configuration for a member that serves no application.
//
// It composes the same blocks the Payload configuration does, minus the ones keyed to paths only a
// Payload application has - the generated mount under `src/app/(payload)`, the collection-config ban,
// the centralised environment module. Those are not relaxations a library is being granted; they are
// carve-outs for files it does not contain, and applying them would have it judged against a layout it
// never claimed. Every cap, ban and suppression rule in `eslint-core.ts` still applies in full.
import {
  baseLayers,
  compose,
  type FlatConfigBlock,
  guidelineRules,
  immutabilityBlock,
  javascriptBlock,
  prettierLast,
  testIntegrityRules,
  typeAwareParsing,
  vitestPlugin,
} from './eslint-core.js'

const IGNORED: readonly string[] = ['dist/**', 'node_modules/**', 'coverage/**', '.next/**']

/** The JavaScript a library may legitimately carry: its own flat ESLint config, and nothing else. */
const JAVASCRIPT_FILES: readonly string[] = ['eslint.config.mjs']

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
  vitestPlugin,
  { files: ['tests/**'], rules: { ...testIntegrityRules } } satisfies FlatConfigBlock,
  prettierLast,
)
