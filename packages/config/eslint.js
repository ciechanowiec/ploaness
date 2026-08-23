// @ts-check
//
// Type-aware ESLint flat config - the second enforcement layer, alongside Biome.
//
// It runs with the TypeScript type-checker wired in (`projectService`), so it catches semantic
// defects a syntax-only linter cannot see: floating promises, unsafe `any` flow, non-exhaustive
// switches, conditions that are always truthy. It also caps complexity so functions stay small and
// flat. Formatting is intentionally NOT handled here - Biome is the single formatter, and
// `eslint-config-prettier` (loaded last) disables every stylistic rule that would conflict.
//
// Philosophy: maximum-explicit. The build should be hard to satisfy by accident, so that code which
// passes is verbose, explicit and readable by construction.

import comments from '@eslint-community/eslint-plugin-eslint-comments/configs'
import js from '@eslint/js'
import vitest from '@vitest/eslint-plugin'
import prettier from 'eslint-config-prettier'
import functional from 'eslint-plugin-functional'
import jsdoc from 'eslint-plugin-jsdoc'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import regexp from 'eslint-plugin-regexp'
import sonarjs from 'eslint-plugin-sonarjs'
import testingLibrary from 'eslint-plugin-testing-library'
import unicorn from 'eslint-plugin-unicorn'
import tseslint from 'typescript-eslint'

const COMPLEXITY_MAX = 8
const MAX_PARAMS = 4
const MAX_DEPTH = 3
const MAX_LINES_PER_FILE = 500
const MAX_LINES_PER_FUNCTION = 50

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
const NO_INLINE_CONFIG_FUNCTIONS_SELECTOR = 'ArrowFunctionExpression, FunctionExpression'
const NO_INLINE_CONFIG_FUNCTIONS_MESSAGE =
  'No inline functions in collection/global/field/block configs. Define behavior (access, hooks, validate) in src/access or src/lib so it is unit-tested, then import it by reference.'

export default tseslint.config(
  // ── What is never linted ────────────────────────────────────────────────────────────────────
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'pgadmin/**',

      '**/*.d.ts',
      'src/payload-types.ts',
      'src/app/(payload)/admin/importMap.js',
      // Tooling configs are formatted/checked by Biome + tsc, not type-linted here.
      // NOTE: `src/payload.config.ts` is deliberately NOT ignored - it is application code
      // (reads env, wires collections) and must be linted like the rest of `src`.
      'eslint.config.mjs',
      'next.config.ts',
      'playwright.config.ts',
      'vitest.config.mts',
    ],
  },

  // ── Base layers ─────────────────────────────────────────────────────────────────────────────
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  sonarjs.configs.recommended,
  unicorn.configs.recommended,
  jsdoc.configs['flat/recommended-typescript'],
  comments.recommended, // disciplined eslint-disable comments (scoped + justified)
  regexp.configs['flat/recommended'], // regex correctness and safety

  // ── Type-aware parsing + the maximum-explicit rule set ──────────────────────────────────────
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
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
      'unicorn/name-replacements': ['error', { replacements: { params: false, req: false, doc: false } }],
      'unicorn/no-null': 'off', // React and Payload use `null` deliberately.
      'unicorn/no-keyword-prefix': 'off',
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
      'no-restricted-properties': [
        'error',
        ...MOCKING_VI_METHODS.map((property) => ({
          object: 'vi',
          property,
          message: NO_MOCKS_MESSAGE,
        })),
      ],
      'no-restricted-imports': [
        'error',
        { paths: MOCKING_PACKAGES.map((name) => ({ name, message: NO_MOCKS_MESSAGE })) },
      ],
    },
  },

  // ── Documenting comment blocks on hand-written modules. Default-safe: every src/ TypeScript module
  //    is in scope, with only the app/route layer, scripts, and generated files exempted (they carry
  //    no reusable API). A new logic directory is therefore held to the rule the moment it exists. ──
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/app/**',
      'src/seed/**',
      'src/payload.config.ts',
      'src/payload-types.ts',
    ],
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: { FunctionDeclaration: true, ClassDeclaration: true, MethodDefinition: true },
          contexts: [
            'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression',
            'TSInterfaceDeclaration',
            'TSTypeAliasDeclaration',
          ],
        },
      ],
      // Payload access/field helpers intentionally return `boolean | Where` (a query constraint).
      'sonarjs/function-return-type': 'off',
    },
  },

  // ── Immutability by default: no `let`, no in-place mutation. Default-safe: every src/ TypeScript
  //    module is in scope, with the app/route layer, scripts, and generated files exempted (they
  //    mutate legitimately). React views are .tsx and fall outside the .ts glob automatically. ──
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/app/**',
      'src/seed/**',
      'src/payload.config.ts',
      'src/payload-types.ts',
    ],
    plugins: { functional },
    rules: {
      'functional/no-let': 'error',
      'functional/immutable-data': 'error',
    },
  },

  // ── React components: return-type/boundary annotations add noise, not safety ─────────────────
  {
    files: ['**/*.tsx'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // A component's JSX return is mostly declarative markup, so the 50-line function cap (meant for
      // imperative logic) misfires on it. The complexity, cognitive-complexity, param, and nesting
      // caps stay ON for .tsx, so genuine logic in a component is still bounded - only raw line count,
      // which JSX legitimately inflates, is exempt. Extract real logic into .ts where the cap holds.
      'max-lines-per-function': 'off',
    },
  },

  // ── Accessibility: lint JSX for a11y defects - missing alt text, unlabeled controls, invalid or
  //    misused ARIA, click handlers with no keyboard equivalent, non-focusable interactive elements.
  //    This is pure static analysis, so it is deterministic (never flaky) and the baseline every site
  //    needs. What it CANNOT see (it does not render): color contrast, focus order, real keyboard
  //    navigation - those need a browser and are covered by axe-in-e2e (see AGENTS.md testing policy).
  {
    files: ['**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: jsxA11y.flatConfigs.recommended.rules,
  },

  // ── Generated Payload mount only: relax type-safety the framework legitimately defeats.
  //    Scoped to `src/app/(payload)/**` (the create-payload-app scaffold + API re-exports), NOT all
  //    of `src/app/**` - `(frontend)`, `oauth`, and any route you hand-write are real code and stay
  //    fully strict so the gate keeps biting as the app grows. ─────────────────────────────────────
  {
    files: ['src/app/(payload)/**', 'src/payload.config.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/require-await': 'off', // async Server Components/layouts are idiomatic.
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/consistent-indexed-object-style': 'off',
      'sonarjs/prefer-read-only-props': 'off',
    },
  },

  // ── Generated route handlers / scaffold under src/app/(payload): don't force annotations on
  //    framework re-exports like `export const GET = REST_GET(config)`. Custom app code is NOT
  //    exempted, and payload.config.ts keeps typedef. ───────────────────────────────────────────
  {
    files: ['src/app/(payload)/**'],
    rules: {
      '@typescript-eslint/typedef': 'off',
    },
  },

  // ── Collection configs: no inline behavior ──────────────────────────────────────────────────
  //    Collections/globals/fields/blocks are declarative wiring, so a function inlined there has no
  //    unit-test seam and escapes the test gates. Force every behavior (access, hooks, validate, and
  //    the like) into src/access or src/lib, where unit tests cover it, and import it by reference.
  //    Scoped by directory so a new config folder is governed automatically.
  {
    files: [
      'src/collections/**/*.ts',
      'src/globals/**/*.ts',
      'src/fields/**/*.ts',
      'src/blocks/**/*.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: NO_INLINE_CONFIG_FUNCTIONS_SELECTOR,
          message: NO_INLINE_CONFIG_FUNCTIONS_MESSAGE,
        },
      ],
    },
  },

  // ── Environment access is centralized in one validated module ─────────────────────────────────
  //    All process.env reads belong in src/lib/environment.ts, which validates and narrows them (and is
  //    unit-tested). Other src modules - including payload.config.ts - must consume the
  //    typed values it returns, never ambient env, so the env surface stays auditable in one place.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/lib/environment.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'Read environment variables only in src/lib/environment.ts (validated there) and consume the typed values; other src modules must not access process.env directly.',
        },
      ],
    },
  },

  // ── Build/util scripts (TypeScript, run via tsx): kept typed and type-checked, but the
  //    app-grade lint rules below don't fit a file-scanning CLI utility. ─────────────────────────
  {
    files: ['scripts/**'],
    rules: {
      'sonarjs/no-os-command-from-path': 'off', // invoking `git` by name is intended here.
      'unicorn/numeric-separators-style': 'off', // codepoint literals (0x2014) read better ungrouped.
      'unicorn/consistent-boolean-name': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off', // line/column numbers in messages.
      'max-depth': 'off', // nested scan loops (file -> line -> char) are inherent.
    },
  },

  // ── Tests: real objects, casts, and long arrange-act-assert bodies are expected ──────────────
  {
    files: ['tests/**'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/typedef': 'off', // test locals often hold framework return types that are noisy to spell out.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      'max-lines-per-function': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'jsdoc/require-jsdoc': 'off',
      'unicorn/no-top-level-assignment-in-function': 'off', // standard vitest beforeAll pattern.
      'unicorn/max-nested-calls': 'off', // expect(fn(arg(value))) assertions are idiomatic.
      'unicorn/numeric-separators-style': 'off', // fixtures use Unicode code points (0x2026); ungrouped reads better.
    },
  },

  // ── Test integrity: the suite is a gate, so the tests themselves are linted ──────────────────
  //    In AI-driven development with little human review, the cheapest way to make a suite lie is to
  //    quietly stop a test from running or asserting. These rules make that a build failure: no `.only`
  //    (which silently skips every other test), no `.skip`/`xit`, no commented-out specs, and every
  //    test must contain a real assertion. The testing-library rules keep component tests user-facing
  //    (query by role/text); assertions use the @testing-library/jest-dom matchers from vitest.setup.
  //    Scoped to the Vitest suite (`tests/int` + `tests/unit`); Playwright e2e specs use a different
  //    runner (and its own `forbidOnly` in CI), so these Vitest/RTL rules do not apply there.
  {
    files: ['tests/int/**/*.ts', 'tests/int/**/*.tsx', 'tests/unit/**/*.ts', 'tests/unit/**/*.tsx'],
    plugins: { vitest, 'testing-library': testingLibrary },
    rules: {
      // A test must actually run and actually assert.
      'vitest/no-focused-tests': 'error', // ban `.only` - it skips the rest of the suite.
      'vitest/no-disabled-tests': 'error', // ban `.skip` / `xit` / `xdescribe`.
      'vitest/no-commented-out-tests': 'error', // a commented-out test is a deleted test that looks present.
      'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'fc.assert'] }], // a fast-check fc.assert property counts as the assertion too.
      // vitest/expect-expect (above) is the assertion-presence gate here and understands fc.assert.
      // sonarjs/assertions-in-tests is a less-configurable duplicate that does not, so it defers in
      // this scope (it stays on for tests/unit, which has no fast-check property tests).
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

      // Property tests must stay deterministic: the fixed global seed (vitest.setup.ts) is the only
      // seed. Forbid per-call `seed` overrides, which would reintroduce a volatile gate.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='fc'][callee.property.name='assert'] > ObjectExpression > Property[key.name='seed']",
          message:
            'Do not set a per-call fast-check seed. Property tests use the fixed global seed in vitest.setup.ts.',
        },
      ],

      // React Testing Library: test components the way a user experiences them.
      'testing-library/await-async-queries': 'error',
      'testing-library/await-async-utils': 'error',
      'testing-library/no-await-sync-queries': 'error',
      'testing-library/no-container': 'error', // query by role/text, not container.querySelector.
      'testing-library/no-debugging-utils': 'error', // no stray screen.debug() in committed tests.
      'testing-library/no-dom-import': ['error', 'react'],
      'testing-library/no-node-access': 'error', // no reaching into DOM internals (.firstChild, ...).
      'testing-library/no-render-in-lifecycle': 'error',
      'testing-library/prefer-screen-queries': 'error',
      'testing-library/prefer-user-event': 'error', // real user interaction over fireEvent.
      'testing-library/render-result-naming-convention': 'error',
    },
  },

  // ── Formatting is Biome's job - disable every conflicting stylistic rule (must stay last) ────
  prettier,
)
