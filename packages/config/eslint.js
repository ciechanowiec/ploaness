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

//
// The framework-neutral half - the caps, the explicitness rules, the naming ban, the suppression
// discipline, the mock ban - lives in ./eslint-core.js and is shared with the ploaness repository's own
// lint run. What stays here is what is genuinely about Payload and Next: the generated mount, the
// collection configs, the environment module, the a11y layer, and the test-integrity block.
import jsxA11y from 'eslint-plugin-jsx-a11y'
import testingLibrary from 'eslint-plugin-testing-library'
import {
  baseLayers,
  compose,
  guidelineRules,
  immutabilityBlock,
  NO_FAST_CHECK_SEED,
  NO_INHERITANCE,
  NO_LITERAL_ASSERTIONS,
  NO_MOCK_PROPERTIES,
  NO_NETWORK_GUARD_ESCAPE,
  NO_TEST_ORDER_ESCAPE,
  prettierLast,
  testIntegrityRules,
  typeAwareParsing,
  vitestPlugin,
} from './eslint-core.js'

const NO_INLINE_CONFIG_FUNCTIONS_SELECTOR = 'ArrowFunctionExpression, FunctionExpression'
const NO_INLINE_CONFIG_FUNCTIONS_MESSAGE =
  'No inline functions in collection/global/field/block configs. Define behavior (access, hooks, ' +
  'validate) in src/access or src/lib so it is unit-tested, then import it by reference.'

export default compose(
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

  ...baseLayers,

  // Type-aware parsing against the consuming project's own tsconfig, plus the shared rule set.
  typeAwareParsing({ projectService: true }),
  { rules: guidelineRules },

  // Immutability: every hand-written TypeScript, with the generated Payload files exempt by role.
  immutabilityBlock(
    ['**/*.ts', '**/*.tsx'],
    [
      'src/app/(payload)/**',
      'src/payload.config.ts',
      'src/payload-types.ts',
      'src/payload-generated-schema.ts',
    ],
  ),

  // ── Documenting comment blocks on hand-written modules. Default-safe: every src/ TypeScript module
  //    is in scope, with only the app/route layer, scripts, and generated files exempted (they carry
  //    no reusable API). A new logic directory is therefore held to the rule the moment it exists. ──
  {
    files: ['src/**/*.ts'],
    ignores: ['src/app/**', 'src/seed/**', 'src/payload.config.ts', 'src/payload-types.ts'],
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

  // ── React components: return-type/boundary annotations add noise, not safety ─────────────────
  {
    files: ['**/*.tsx'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
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
        ...NO_INHERITANCE,
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
      // `NO_MOCK_PROPERTIES` is spread in beside the env rule because this key REPLACES the base
      // setting rather than adding to it - naming only the env restriction here switched the
      // build-wide mock ban off across the whole of `src/`, which is the trap `eslint-core.js`
      // documents for `no-restricted-syntax` and which this key falls into identically.
      'no-restricted-properties': [
        'error',
        ...NO_MOCK_PROPERTIES,
        {
          object: 'process',
          property: 'env',
          message:
            'Read environment variables only in src/lib/environment.ts (validated there) and ' +
            'consume the typed values; other src modules must not access process.env directly.',
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
      // `max-depth` and `restrict-template-expressions` were off here. Both carry rules of the
      // governing standard - the nesting cap, and "conversions between types are spelled out" - and a
      // cap is never raised. A scan loop that needs four levels is a scan loop that wants a named
      // helper for its inner pass.
    },
  },

  // ── Tests: real objects, casts, and long arrange-act-assert bodies are expected ──────────────
  {
    files: ['tests/**'],
    rules: {
      // Only framework idiom is relaxed here. Every rule that carries a rule of the governing standard -
      // the size caps, the explicitness rules, the ban on a non-null assertion, the unsafe-any family -
      // stays ON, because the standard says test code passes the same static-analysis checks as
      // production code. A relaxation that made a test easier to write by making it less checked would
      // exempt the suite from the contract it exists to enforce.
      // A test's expected value IS its specification. Naming it moves the specification away from the
      // assertion that reads it, which makes the test harder to check by eye rather than easier - the
      // opposite of what the bare-number ban exists to achieve. This is a role distinction, not a
      // convenience: production code names its constants, and a spec states its literals.
      '@typescript-eslint/no-magic-numbers': 'off',
      'sonarjs/no-duplicate-string': 'off', // fixture data repeats by nature; naming each is noise.
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
  //    (query by role/text); assertions use the @testing-library/jest-dom matchers, which a project
  //    registers in a `vitest.setup.ts` of its own if it writes component tests.
  //    Scoped to the Vitest suite (`tests/int` + `tests/unit`); Playwright e2e specs use a different
  //    runner (and its own `forbidOnly` in CI), so these Vitest/RTL rules do not apply there.
  {
    files: ['tests/int/**/*.ts', 'tests/int/**/*.tsx', 'tests/unit/**/*.ts', 'tests/unit/**/*.tsx'],
    plugins: { vitest: vitestPlugin, 'testing-library': testingLibrary },
    rules: {
      // A test must actually run and actually assert. The rules live in eslint-core.js, because the
      // ploaness repository's own suite is held to them too.
      ...testIntegrityRules,
      'no-restricted-syntax': [
        ...NO_INHERITANCE,
        ...NO_LITERAL_ASSERTIONS,
        ...NO_FAST_CHECK_SEED,
        ...NO_TEST_ORDER_ESCAPE,
        ...NO_NETWORK_GUARD_ESCAPE,
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

  // Playwright has its own runner, but a spec body can still create an unguarded Node transport before
  // it asks the browser to do anything. The Vitest-specific integrity rules do not fit here; the network
  // escape ban does, and carries the same selectors rather than a second list.
  {
    files: ['tests/e2e/**/*.ts', 'tests/e2e/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [...NO_INHERITANCE, ...NO_NETWORK_GUARD_ESCAPE],
    },
  },

  // ── Formatting is Biome's job - disable every conflicting stylistic rule (must stay last) ────
  prettierLast,
)
