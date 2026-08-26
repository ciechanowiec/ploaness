// The framework-neutral half of the ploaness ESLint contract.
//
// It was extracted because ploaness never ran ESLint on itself. The rules below carry every size cap,
// explicitness rule, naming ban, and suppression discipline the governing standard states - and the
// harness that publishes them was not measured by them. Sharing only the five cap NUMBERS would have
// left roughly seventy rule declarations to drift; the blocks are shared instead, and the globs are the
// caller's, because the globs are the only genuinely project-shaped part.
//
// `packages/config/eslint.js` composes these with the Payload-specific blocks. The ploaness repository
// composes them with its own workspace layout. Neither restates a rule.
import js from '@eslint/js'
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs'
import vitest from '@vitest/eslint-plugin'
import prettier from 'eslint-config-prettier'
import functional from 'eslint-plugin-functional'
import jsdoc from 'eslint-plugin-jsdoc'
import regexp from 'eslint-plugin-regexp'
import sonarjs from 'eslint-plugin-sonarjs'
import unicorn from 'eslint-plugin-unicorn'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const COMPLEXITY_MAX = 8
const MAX_PARAMS = 4
const MAX_DEPTH = 3
const MAX_LINES_PER_FILE = 500
const MAX_LINES_PER_FUNCTION = 50
const MIN_NAME_LENGTH = 2
// The governing standard's "short structural-value allowlist".
const STRUCTURAL_NUMBERS = [-1, 0, 1]

// No mocks. Tests run against real objects and real services (a real Payload instance, a real
// database, real in-process servers) - never test doubles. These are the Vitest entry points that
// create mocks/stubs/spies, plus the third-party mocking libraries, all banned build-wide.
const NO_MOCKS_MESSAGE =
  'No mocks/stubs/spies. Test against real objects and real services instead (see AGENTS.md).'
const MOCKING_VI_METHODS = [
  'fn',
  'mock',
  'doMock',
  'unmock',
  'mocked',
  'spyOn',
  'stubGlobal',
  'stubEnv',
  'importMock',
]
const MOCKING_PACKAGES = [
  'sinon',
  'testdouble',
  'jest-mock',
  '@jest/globals',
  'proxyquire',
  'nock',
  'msw',
]

// Collection/global/field/block configs are declarative wiring: importing one already satisfies its
// coverage, so a function inlined there has no unit-test seam and can sit untested. This rule bans
// inline functions in those files, forcing extraction into the unit-tested src/access and src/lib
// modules, then reference by name. Identifier references (`read: anyone`) pass; inline functions do not.
// A flat-config block that sets `no-restricted-syntax` REPLACES the setting rather than adding to it, so
// a scoped block would silently drop these. Spread into every such array instead of restating them.
const INHERITANCE_MESSAGE =
  'Add behavior by composing objects, not by inheriting. Inherit only from a base the ' +
  'language or a dependency requires.'
// The mock ban as ENTRIES rather than as a finished rule setting, for the reason the comment above
// `NO_INHERITANCE` gives: a scoped block that sets `no-restricted-properties` REPLACES this rather than
// adding to it. `eslint.js` set that key for `src/**` to the process.env rule alone, which switched the
// build-wide mock ban off across a project's whole source tree without a word anywhere saying so.
const NO_MOCK_PROPERTIES = MOCKING_VI_METHODS.map((property) => ({
  object: 'vi',
  property,
  message: NO_MOCKS_MESSAGE,
}))

const NO_INHERITANCE = [
  'error',
  {
    selector: 'ClassDeclaration[superClass]:not([superClass.name="Error"])',
    message: INHERITANCE_MESSAGE,
  },
  {
    selector: 'ClassExpression[superClass]:not([superClass.name="Error"])',
    message: INHERITANCE_MESSAGE,
  },
]

// An assertion whose operands are literals alone cannot fail when the code under test changes, so it
// reports as passing while judging nothing. This catches the exact form the standard names; the general
// rule is not statically decidable and is stated in the agent guide instead.
const LITERAL_ASSERTION_MESSAGE =
  'An assertion over a literal cannot fail when the code under test changes. Assert an observable outcome.'
const NO_LITERAL_ASSERTIONS = [
  {
    selector: "CallExpression[callee.name='expect'] > Literal",
    message: LITERAL_ASSERTION_MESSAGE,
  },
  {
    selector: "CallExpression[callee.name='expect'] > TemplateLiteral[expressions.length=0]",
    message: LITERAL_ASSERTION_MESSAGE,
  },
  {
    selector: "CallExpression[callee.name='expect'] > UnaryExpression[operator='-'] > Literal",
    message: LITERAL_ASSERTION_MESSAGE,
  },
]

/** Re-exported so a caller declares no plugin version of its own. */
export const compose = tseslint.config

/** Formatting is Biome's job; this disables every conflicting stylistic rule and must stay last. */
export const prettierLast = prettier

// A warning severity does not exist in a governed repository: a check has two verdicts, and a finding
// that prints and exits 0 is neither. Several presets ship rules at `warn` anyway - 31 of jsdoc's and 6
// of regexp's, as of this writing - so every finding they report was invisible to the build.
//
// The list of which rules those are is NOT written down here. It would be a copy of what the presets
// declare, and it would go stale on the next upgrade in the one direction that fails open. Each layer's
// own declarations are re-read instead and raised to `error`, options intact. A rule a preset turns
// `off` stays off: that is a decision about whether the rule runs, not about how loudly it speaks.
const escalate = (setting) => {
  const severity = Array.isArray(setting) ? setting[0] : setting
  if (severity === 'off' || severity === 0) {
    return setting
  }
  return Array.isArray(setting) ? ['error', ...setting.slice(1)] : 'error'
}

const withoutWarnings = (layer) =>
  layer.rules === undefined
    ? layer
    : {
        ...layer,
        rules: Object.fromEntries(
          Object.entries(layer.rules).map(([id, setting]) => [id, escalate(setting)]),
        ),
      }

/** The preset layers every ploaness-governed project runs, none of which may report at `warn`. */
export const baseLayers = [
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  sonarjs.configs.recommended,
  unicorn.configs.recommended,
  // The plugin's own error-severity variant of the same preset. The escalation above would raise it
  // anyway; naming the variant states the intent where a reader of the layer list will see it.
  jsdoc.configs['flat/recommended-typescript-error'],
  comments.recommended, // disciplined eslint-disable comments (scoped + justified)
  regexp.configs['flat/recommended'], // regex correctness and safety
].map(withoutWarnings)

/**
 * Type-aware parsing, with the caller supplying the parser options its layout needs.
 * @param parserOptions the typescript-eslint parser options.
 * @returns a flat-config block.
 */
export const typeAwareParsing = (parserOptions) => ({ languageOptions: { parserOptions } })

/** The maximum-explicit rule set: the caps, the explicitness rules, the bans, the mock ban. */
export const guidelineRules = {
  // Explicitness - types must be written, not just inferred at boundaries.
  '@typescript-eslint/explicit-function-return-type': 'error',
  '@typescript-eslint/explicit-module-boundary-types': 'error',
  // Require an explicit type annotation on every `const`/`let` (not just boundaries), so the
  // declared type is written rather than left to inference. Arrow-function consts are exempt -
  // their signature is already covered by explicit-function-return-type.
  '@typescript-eslint/typedef': [
    'error',
    { variableDeclaration: true, variableDeclarationIgnoreFunction: true },
  ],
  // Conflicts with the explicit philosophy: typedef requires annotations, this rule would strip
  // the "trivially inferable" ones (e.g. `const x: string = '...'`). We want them written.
  '@typescript-eslint/no-inferrable-types': 'off',
  '@typescript-eslint/no-non-null-assertion': 'error',
  '@typescript-eslint/strict-boolean-expressions': 'error',
  '@typescript-eslint/switch-exhaustiveness-check': 'error',
  '@typescript-eslint/no-unnecessary-condition': 'error',
  // Defect patterns - bugs the type-checker can prove.
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  '@typescript-eslint/default-param-last': 'error',
  '@typescript-eslint/require-array-sort-compare': ['error', { ignoreStringArrays: true }],
  // Ban calls into APIs marked `@deprecated` - yours or a framework's (Payload/Next/React). The
  // type-checker reads the JSDoc tag and fails the build at the call site, so deprecated usage is
  // caught statically rather than at runtime. (AI models especially reach for deprecated APIs from
  // stale training data; this stops that at the gate.)
  '@typescript-eslint/no-deprecated': 'error',
  // Naming - ban the "plumbing" type-name suffixes (`Service`/`Manager`/`Handler`/`Provider`/
  // `Util`): a type is a noun of the domain, or the operation belongs to the domain type that owns
  // it (mask on `MaskedToken`, not a `TokenMasker`). Scoped to type declarations, so a domain
  // property like `packageManager` or a framework import like `NextIntlClientProvider` is untouched.
  '@typescript-eslint/naming-convention': [
    'error',
    {
      selector: ['class', 'interface', 'typeAlias', 'enum'],
      format: null,
      custom: { regex: '(Service|Manager|Handler|Provider|Util)$', match: false },
    },
  ],

  // Suppressions must be deliberate: every eslint-disable needs a reason, and dead ones fail.
  '@eslint-community/eslint-comments/require-description': ['error', { ignore: [] }],
  '@eslint-community/eslint-comments/no-unused-disable': 'error',

  // Complexity caps - keep every unit small, flat and testable.
  complexity: ['error', COMPLEXITY_MAX],
  'sonarjs/cognitive-complexity': ['error', COMPLEXITY_MAX],
  'max-params': ['error', MAX_PARAMS],
  'max-depth': ['error', MAX_DEPTH],
  'max-lines': ['error', { max: MAX_LINES_PER_FILE, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': [
    'error',
    { max: MAX_LINES_PER_FUNCTION, skipBlankLines: true, skipComments: true },
  ],

  // Bare numbers. The governing standard bans a number outside the declaration of a named constant,
  // and allows "a short structural-value allowlist, such as 0 and 1". -1 earns its place beside them
  // as the indexOf/findIndex sentinel, which is a structural value rather than a magic one.
  // The @typescript-eslint variant, not the base rule: only it understands enums, numeric literal
  // types, and type indexes, all of which a Payload project has. Biome's noMagicNumbers is
  // deliberately NOT enabled alongside it - that rule has no allowlist option, so it cannot express
  // the carve-out the standard grants, and it would double-report every finding across two gates.
  '@typescript-eslint/no-magic-numbers': [
    'error',
    {
      ignore: STRUCTURAL_NUMBERS,
      ignoreArrayIndexes: true,
      ignoreDefaultValues: true,
      ignoreClassFieldInitialValues: true,
      ignoreEnums: true,
      ignoreNumericLiteralTypes: true,
      ignoreReadonlyClassProperties: true,
      ignoreTypeIndexes: true,
      enforceConst: true,
      detectObjects: false,
    },
  ],

  // One-character names. `maskedToken` says what `m` hides. `_` is exempt because it is the
  // placeholder the language reserves for an unused value, which TypeScript's noUnusedParameters
  // already honours. Object properties are exempt because a key is frequently an external API's
  // vocabulary rather than a name anyone chose.
  'id-length': ['error', { min: MIN_NAME_LENGTH, properties: 'never', exceptions: ['_'] }],

  // TODO and FIXME are banned outright. `unicorn/expiring-todo-comments` arrives ON from the
  // recommended preset and contradicts that: its whole premise is that a TODO is acceptable when it
  // carries an expiry date. The ban has no such exception, so the rule is turned off rather than
  // left to license what this one forbids.
  'no-warning-comments': ['error', { terms: ['todo', 'fixme'], location: 'anywhere' }],
  'unicorn/expiring-todo-comments': 'off',

  // Composition over inheritance. A type inherits only from a base the language or a dependency
  // requires, and the error base is the one such base that appears in ordinary code.
  'no-restricted-syntax': [...NO_INHERITANCE],

  // Control-flow clarity.
  eqeqeq: ['error', 'always'],
  curly: ['error', 'all'],
  'default-case': 'error',
  'no-else-return': ['error', { allowElseIf: false }],

  // Unicorn tuned for the Payload/Next reality.
  'unicorn/prevent-abbreviations': 'off', // req/params/props/config are intentional here.
  // Keep the sibling name-replacements rule ON (it catches genuine abbreviations like refs/dev), but
  // exempt the words the frameworks mandate verbatim: `params` (the Next.js App Router route prop and
  // its `generateStaticParams` export) and `req`/`doc` (Payload's fixed hook/endpoint argument names -
  // every Payload hook, access function, and endpoint handler receives `req`, and change/read hooks
  // receive `doc`). `: false` removes only those replacements; every other abbreviation is still reported.
  'unicorn/name-replacements': [
    'error',
    { replacements: { params: false, req: false, doc: false } },
  ],
  // A predicate named as a third-person verb - `matchesAny`, `reachesThreshold`, `declaresKey` -
  // already says plainly what it does, which is what the naming rule asks for. Rewriting those as
  // `isMatchingAny` would make them read worse, so the verb forms are allowed alongside the default
  // prefixes. Every other boolean still has to announce itself as one.
  'unicorn/consistent-boolean-name': [
    'error',
    {
      prefixes: {
        matches: true,
        reaches: true,
        opens: true,
        declares: true,
        ends: true,
        exists: true,
        contains: true,
        starts: true,
        carries: true,
        covers: true,
      },
    },
  ],
  // These three propose methods that the declared `lib` target does not carry: Iterator#toArray,
  // Array#toSorted, and Set#union are all newer than the platform this contract compiles against. Their
  // autofixes produce code that does not compile, which is worse than the pattern they replace. None of
  // them carries a rule of the governing standard - they are style preferences about newer syntax.
  // `reduce` is how a fold is written without a mutable accumulator, which is precisely what the
  // immutability rule above requires. Banning it would leave no way to satisfy both, and the governing
  // standard says nothing about which array method expresses a fold.
  // Omitting a key by destructuring binds a name precisely so it can be dropped; that binding is
  // deliberately unused and is the idiomatic alternative to `delete`, which mutates.
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      ignoreRestSiblings: true,
      varsIgnorePattern: '^_',
      argsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    },
  ],
  'sonarjs/no-unused-vars': 'off', // the typed rule above decides this, with the project's options.
  // ploaness exists to invoke analyzers, and it invokes them by name so the project's own installed
  // version is the one that runs. Resolving each to an absolute path would pin the harness to one
  // layout and defeat that. The governing standard says nothing about PATH.
  'sonarjs/no-os-command-from-path': 'off',
  'unicorn/no-array-reduce': 'off',
  'unicorn/prefer-iterator-to-array': 'off',
  'unicorn/no-array-sort': 'off',
  'unicorn/prefer-set-methods': 'off',
  'unicorn/no-null': 'off', // React and Payload use `null` deliberately.
  'unicorn/no-keyword-prefix': 'off',
  // A DIRECT contradiction rather than a preference. Biome's `useNumberNamespace` requires
  // `Number.NaN` and `Number.POSITIVE_INFINITY`; this rule requires the bare globals, so no source
  // text satisfies both linters and the only escapes are a suppression or contorting the code to
  // avoid the constant. Biome decides, for the reason it already decides formatting: the two must
  // never disagree about the same character, so one of them owns style and the other defers.
  'unicorn/prefer-global-number-constants': 'off',
  // New in unicorn 73. It would expand every concise one-line `/** ... */` export doc into a
  // three-line block, and would also rewrite the `GENERATED AUTOMATICALLY BY PAYLOAD` /
  // `DO NOT MODIFY` headers that Payload writes into the `src/app/(payload)` scaffolding.
  'unicorn/single-line-block-comment-style': 'off',
  'unicorn/filename-case': [
    'error',
    { cases: { camelCase: true, pascalCase: true, kebabCase: true } },
  ],

  // JSDoc: require a doc *block* on public helpers (below), but never the per-`@param root0`
  // ceremony that destructured arrow signatures produce. Keep the correctness checks on.
  'jsdoc/require-jsdoc': 'off',
  'jsdoc/require-param': 'off',
  'jsdoc/require-returns': 'off',

  // No mocks - ban the mocking entry points and libraries build-wide.
  'no-restricted-properties': ['error', ...NO_MOCK_PROPERTIES],
  'no-restricted-imports': [
    'error',
    { paths: MOCKING_PACKAGES.map((name) => ({ name, message: NO_MOCKS_MESSAGE })) },
  ],
}

// Test integrity. In AI-driven development with little human review, the cheapest way to make a suite
// lie is to quietly stop a test from running or asserting: `.only` skips every other test, `.skip` and a
// commented-out spec remove one while it still reads as present, and a test with no assertion drives the
// code without judging what it produced. These make each of those a build failure.
//
// It lived only in the shipped config, so the harness published the check and was not measured by it -
// the same asymmetry that put the caps and the naming bans in this file.
/** The plugin the block below needs, re-exported so a caller declares no version of its own. */
export const vitestPlugin = vitest

/** The Vitest half of the test-integrity block, shared by every config that lints a Vitest suite. */
export const testIntegrityRules = {
  'vitest/no-focused-tests': 'error', // ban `.only` - it skips the rest of the suite.
  'vitest/no-disabled-tests': 'error', // ban `.skip` / `xit` / `xdescribe`.
  'vitest/no-commented-out-tests': 'error', // a commented-out test is a deleted test that looks present.
  // a fast-check fc.assert property counts as the assertion too.
  'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'fc.assert'] }],
  // vitest/expect-expect (above) is the assertion-presence gate here and understands fc.assert.
  // sonarjs/assertions-in-tests is a less-configurable duplicate that does not, so it defers in
  // this scope.
  'sonarjs/assertions-in-tests': 'off',
  'vitest/valid-expect': 'error', // `expect` is called correctly (awaited, matcher present).
  'vitest/no-standalone-expect': 'error', // assertions must live inside a test.
  'vitest/no-conditional-expect': 'error', // an assertion behind an `if` may never execute.
  'vitest/no-conditional-tests': 'error', // tests must not be defined conditionally.
  'vitest/no-identical-title': 'error', // duplicate titles hide one test behind another.
  'vitest/valid-title': 'error',
  'vitest/no-import-node-test': 'error', // use the Vitest API, not node:test.
  'vitest/consistent-test-it': ['error', { fn: 'it' }],
  'vitest/prefer-hooks-on-top': 'error', // setup before assertions, so reading order matches run order.
}

// Property tests must stay deterministic: one seed decides the whole suite, and a per-call override
// reintroduces a gate whose verdict changes between two runs of an unchanged repository, which is the
// one thing a check may never do.
//
// Setting that global seed is the project's job, in its own `vitest.setup.ts`. It cannot be done from
// the shipped setup file: that file lives inside node_modules, and a `fast-check` reached from there is
// a different module record from the one the suite loads, so configuring it would configure nothing. The
// message therefore says whose job it is rather than claiming ploaness has already done it.
const NO_FAST_CHECK_SEED = [
  {
    selector:
      "CallExpression[callee.object.name='fc'][callee.property.name='assert'] > " +
      "ObjectExpression > Property[key.name='seed']",
    message:
      'Do not set a per-call fast-check seed. Set one global seed in vitest.setup.ts, so a failing ' +
      'property is reproducible by rerunning.',
  },
]

// The two determinism mechanisms the shipped Vitest config installs, and the ways a spec could reach
// past them. Neither is a substitute for the mechanism: the network guard is installed non-configurable
// and the sequence block is out of a project's reach entirely. Raw datagrams and a new process or worker
// do not pass through the patched runtime, so those entry points are refused statically instead of being
// wrapped incompletely. The selectors make every escape attempt a finding before the suite runs.
const NO_NETWORK_GUARD_ESCAPE = [
  {
    selector:
      'ImportDeclaration[source.value=/^(?:node:)?(?:child_process|cluster|dgram|worker_threads)$/]',
    message:
      'Tests may not import datagram, process, or worker APIs, because they run outside the network ' +
      'guard. Use a real component on this machine from the guarded test runtime.',
  },
  {
    selector:
      'ImportExpression[source.value=/^(?:node:)?(?:child_process|cluster|dgram|worker_threads)$/]',
    message:
      'Tests may not dynamically import datagram, process, or worker APIs, because they run outside ' +
      'the network guard.',
  },
  {
    selector:
      "CallExpression[callee.name='require']" +
      '[arguments.0.value=/^(?:node:)?(?:child_process|cluster|dgram|worker_threads)$/]',
    message:
      'Tests may not require datagram, process, or worker APIs, because they run outside the network ' +
      'guard.',
  },
  {
    selector:
      "CallExpression[callee.object.name='process'][callee.property.name='getBuiltinModule']" +
      '[arguments.0.value=/^(?:node:)?(?:child_process|cluster|dgram|worker_threads)$/]',
    message:
      'Tests may not load datagram, process, or worker builtins, because they run outside the network ' +
      'guard.',
  },
  {
    selector: 'NewExpression[callee.name=/^(?:SharedWorker|Worker)$/]',
    message:
      'Tests may not create a worker, because its isolated runtime does not carry the network guard.',
  },
  {
    selector:
      "AssignmentExpression[left.object.property.name='prototype'][left.property.name='connect']",
    message:
      'Do not reinstall a socket method. A test reaches no network beyond the machine it runs on, ' +
      "and the guard that decides that is the harness's.",
  },
  {
    selector: "AssignmentExpression[left.object.name='globalThis'][left.property.name='fetch']",
    message:
      'Do not replace the global fetch. Point the test at a real component on this machine instead.',
  },
  // The bare assignment is not the only way to replace it, and it is the least likely one to be
  // reached for by someone working around the guard on purpose. `globalThis.fetch` is the one property
  // the guard leaves configurable - a DOM environment swaps the globals between files and a frozen
  // fetch would break that - so these three routes to it are named as well.
  {
    selector:
      "CallExpression[callee.object.name='Object'][callee.property.name='defineProperty']" +
      "[arguments.0.name='globalThis'][arguments.1.value='fetch']",
    message:
      'Do not redefine the global fetch. Point the test at a real component on this machine instead.',
  },
  {
    selector:
      "CallExpression[callee.object.name='Reflect'][callee.property.name='set']" +
      "[arguments.0.name='globalThis'][arguments.1.value='fetch']",
    message:
      'Do not replace the global fetch. Point the test at a real component on this machine instead.',
  },
  {
    selector: "AssignmentExpression[left.object.name='global'][left.property.name='fetch']",
    message:
      'Do not replace the global fetch. Point the test at a real component on this machine instead.',
  },
]

// Ordering is decided once, by the shipped sequence block. A per-test escape reintroduces exactly the
// coupling the shuffle exists to find, and `vi.setConfig` reintroduces the per-run seed.
// `describe.shuffle` is deliberately absent from this list: it only strengthens.
const NO_TEST_ORDER_ESCAPE = [
  {
    selector:
      "MemberExpression[object.name=/^(?:it|test|describe|suite)$/][property.name='sequential']",
    message:
      'Do not pin one test to declaration order. A test reaches its verdict whatever order the suite ' +
      'runs in; if this one cannot, the coupling is the defect.',
  },
  {
    selector:
      "MemberExpression[object.name=/^(?:it|test|describe|suite)$/][property.name='concurrent']",
    message:
      'Do not run tests concurrently. Interleaving makes order-coupling harder to see rather than ' +
      'impossible to have.',
  },
  {
    selector: "CallExpression[callee.object.name='vi'][callee.property.name='setConfig']",
    message:
      "Do not reconfigure the runner from a spec. The sequence and its seed are the harness's.",
  },
]

/**
 * The same contract, applied to a file that is JavaScript rather than TypeScript.
 *
 * A check a repository implements itself is source code of that repository, so the programs that
 * implement one are held to the code rules like anything else - and a build script or a runtime shim
 * cannot be TypeScript, because the tool that loads it reads it as JavaScript. The rule list is not
 * restated here: it is the same object, minus the four rules that ask for syntax a JavaScript file
 * cannot carry, and with the bare-number ban expressed through the base rule because the typed variant
 * reads type information such a file does not have. The allowlist it reads is the same one.
 * @param files the glob patterns this block governs.
 * @returns a flat-config block.
 */
export const javascriptBlock = (files) => ({
  files,
  extends: [tseslint.configs.disableTypeChecked],
  // Declared rather than inferred. `no-undef` is off for every TypeScript file here because the
  // compiler decides that question; on a JavaScript file the rule is live, and it has to be told which
  // names the runtime supplies. These programs run on node without a CommonJS wrapper.
  languageOptions: { globals: globals.nodeBuiltin },
  rules: {
    ...guidelineRules,
    // Re-applied AFTER the rule list above. `extends` places the disabling block BEFORE the block's own
    // rules, so spreading the list on top would switch every type-aware rule back on for a file that has
    // no type information for one to read - which fails the run outright rather than reporting.
    ...tseslint.configs.disableTypeChecked.rules,
    // A JavaScript file has nowhere to write a return type, a parameter type, or a variable annotation.
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/typedef': 'off',
    // The typed variant understands enums and type indexes, which is why it is the one TypeScript reads;
    // here there are none, and the base rule expresses the same allowlist.
    '@typescript-eslint/no-magic-numbers': 'off',
    'no-magic-numbers': [
      'error',
      {
        ignore: STRUCTURAL_NUMBERS,
        ignoreArrayIndexes: true,
        ignoreDefaultValues: true,
        ignoreClassFieldInitialValues: true,
        enforceConst: true,
        detectObjects: false,
      },
    ],
  },
})

/** No `let`, no in-place mutation. The caller supplies the files and the generated-role exemptions. */
export const immutabilityBlock = (files, ignores) => ({
  files,
  ignores,
  plugins: { functional },
  rules: {
    'functional/no-let': 'error',
    'functional/immutable-data': 'error',
  },
})

/** The shared selectors, re-exported so a scoped block can spread rather than restate them. */
export {
  NO_FAST_CHECK_SEED,
  NO_INHERITANCE,
  NO_LITERAL_ASSERTIONS,
  NO_MOCK_PROPERTIES,
  NO_NETWORK_GUARD_ESCAPE,
  NO_TEST_ORDER_ESCAPE,
}
