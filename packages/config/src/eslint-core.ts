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
import { PROJECT_SETUP_FILE } from '@ploaness/governance'
import vitest from '@vitest/eslint-plugin'
import type { Linter } from 'eslint'
import { defineConfig } from 'eslint/config'
import prettier from 'eslint-config-prettier'
import functional from 'eslint-plugin-functional'
import jsdoc from 'eslint-plugin-jsdoc'
import regexp from 'eslint-plugin-regexp'
import sonarjs from 'eslint-plugin-sonarjs'
import unicorn from 'eslint-plugin-unicorn'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * One flat-config block, described by its shape rather than by the plugins' own declarations.
 *
 * Those declarations name symbols from deep inside the dependency tree - `Immutability` from
 * is-immutable-type, `RuleEnforcementComparator` from eslint-plugin-functional - which a declaration
 * file emitted beside this module cannot reference portably, and naming them would make each of those
 * packages resolvable-from-here a condition of consuming this one. `packages/ploaness` records the same
 * decision for its own re-exports. A module that composes blocks and hands them to ESLint needs their
 * shape, not their provenance; ESLint validates the result it is given.
 */
export type FlatConfigBlock = Readonly<Record<string, unknown>>

/**
 * One rule table: a rule id against whatever that rule's own declaration accepts.
 *
 * ESLint's own type rather than a structural stand-in. `eslint` is a declared dependency of this
 * package - every plugin imported above requires it at runtime - so naming the real type costs nothing
 * and lets a caller spread this table into a config block without an assertion. That matters here
 * because an assertion is uncovered by the type coverage measurement this repository holds at 100%.
 */
export type RuleTable = Partial<Linter.RulesRecord>

/** One `no-restricted-syntax` entry: the shape to reject, and what to say when it appears. */
export interface RestrictedSyntax {
  readonly selector: string
  readonly message: string
}

/**
 * A whole `no-restricted-syntax` setting: the severity first, then the shapes.
 *
 * A tuple rather than an array, because that is what the rule's own declaration is. Typed as a plain
 * array, the severity in position zero is indistinguishable from an entry, and a caller spreading this
 * into a config block gets a type error it can only clear with an assertion.
 *
 * The severity is the literal rather than ESLint's own union: a warning severity does not exist in a
 * governed repository, which is the rule the escalation below enforces on every preset layer.
 */
export type RestrictedSyntaxSetting = readonly ['error', ...RestrictedSyntax[]]

/** One `no-restricted-properties` entry: the member access to reject, and what to say instead. */
export interface RestrictedProperty {
  readonly object: string
  readonly property: string
  readonly message: string
}

/** Composes flat-config blocks into the array ESLint reads. */
export type Compose = (...blocks: readonly unknown[]) => readonly FlatConfigBlock[]

// Narrowing rather than a property read: `rules` arrives as `unknown` out of the index signature above,
// and a layer that carries none is passed through untouched.
const isRuleTable = (value: unknown): value is RuleTable =>
  typeof value === 'object' && value !== null

const COMPLEXITY_MAX: number = 8
const MAX_PARAMS: number = 4
const MAX_DEPTH: number = 3
const MAX_LINES_PER_FILE: number = 500
const MAX_LINES_PER_FUNCTION: number = 50
const MIN_NAME_LENGTH: number = 2
// The governing standard's "short structural-value allowlist".
const STRUCTURAL_NUMBERS: readonly number[] = [-1, 0, 1]

// No mocks. Tests run against real objects and real services (a real Payload instance, a real
// database, real in-process servers) - never test doubles. These are the Vitest entry points that
// create mocks/stubs/spies, plus the third-party mocking libraries, all banned build-wide.
const NO_MOCKS_MESSAGE: string =
  'No mocks/stubs/spies. Test against real objects and real services instead (see AGENTS.md).'
const MOCKING_VI_METHODS: readonly string[] = [
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
const MOCKING_PACKAGES: readonly string[] = [
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
const INHERITANCE_MESSAGE: string =
  'Add behavior by composing objects, not by inheriting. Inherit only from a base the ' +
  'language or a dependency requires.'
// The mock ban as ENTRIES rather than as a finished rule setting, for the reason the comment above
// `NO_INHERITANCE` gives: a scoped block that sets `no-restricted-properties` REPLACES this rather than
// adding to it. `eslint.js` set that key for `src/**` to the process.env rule alone, which switched the
// build-wide mock ban off across a project's whole source tree without a word anywhere saying so.
const NO_MOCK_PROPERTIES: readonly RestrictedProperty[] = MOCKING_VI_METHODS.map((property) => ({
  object: 'vi',
  property,
  message: NO_MOCKS_MESSAGE,
}))

const NO_INHERITANCE: RestrictedSyntaxSetting = [
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
//
// Anchored on the FIRST argument, which is the operand. Written as a child combinator over the whole
// call - `CallExpression[callee.name='expect'] > Literal` - it matched a literal in ANY argument
// position, and `expect` takes a second one: the message Vitest prints when the assertion fails. So the
// rule rejected `expect(parsed, 'the value that got through')`, which is not an assertion over a
// literal at all, and rejected it with a message describing a defect the line does not have. What
// survived was the one spelling neither this rule nor `vitest/valid-expect` happened to catch, a
// template literal carrying a substitution - and every shipped spec in `packages/assets` uses it,
// which is why nothing here ever reported the hole.
const LITERAL_ASSERTION_MESSAGE: string =
  'An assertion over a literal cannot fail when the code under test changes. Assert an observable outcome.'
const EXPECT_CALL: string = "CallExpression[callee.name='expect']"
const NO_LITERAL_ASSERTIONS: readonly RestrictedSyntax[] = [
  {
    selector: `${EXPECT_CALL}[arguments.0.type='Literal']`,
    message: LITERAL_ASSERTION_MESSAGE,
  },
  {
    selector: `${EXPECT_CALL}[arguments.0.type='TemplateLiteral'][arguments.0.expressions.length=0]`,
    message: LITERAL_ASSERTION_MESSAGE,
  },
  {
    selector:
      `${EXPECT_CALL}[arguments.0.type='UnaryExpression'][arguments.0.operator='-']` +
      "[arguments.0.argument.type='Literal']",
    message: LITERAL_ASSERTION_MESSAGE,
  },
]

/**
 * Re-exported so a caller declares no plugin version of its own.
 *
 * `defineConfig` rather than `tseslint.config`, which typescript-eslint deprecated in favour of it: the
 * composition of flat-config blocks is ESLint's own concern now, and this is where a governed project
 * reaches it. `eslint` is declared as a dependency of this package for the same reason - every plugin
 * imported above already requires it at runtime, and resolving it out of whatever the consumer happens
 * to have hoisted is a resolution this package should not depend on.
 *
 * Typed against `FlatConfigBlock` rather than against `defineConfig`'s own parameter type, for the
 * reason that alias exists. This assertion is the single place the widening happens: every caller then
 * composes blocks without one of its own, and a block's shape is still checked by ESLint, which is the
 * only thing that can validate a rule's options anyway.
 */
export const compose: typeof defineConfig = defineConfig

/** Formatting is Biome's job; this disables every conflicting stylistic rule and must stay last. */
export const prettierLast: FlatConfigBlock = prettier

// A warning severity does not exist in a governed repository: a check has two verdicts, and a finding
// that prints and exits 0 is neither. Several presets ship rules at `warn` anyway - 31 of jsdoc's and 6
// of regexp's, as of this writing - so every finding they report was invisible to the build.
//
// The list of which rules those are is NOT written down here. It would be a copy of what the presets
// declare, and it would go stale on the next upgrade in the one direction that fails open. Each layer's
// own declarations are re-read instead and raised to `error`, options intact. A rule a preset turns
// `off` stays off: that is a decision about whether the rule runs, not about how loudly it speaks.
const isOff = (severity: unknown): boolean => severity === 'off' || severity === 0

const escalate = (setting: unknown): unknown => {
  if (!Array.isArray(setting)) {
    return isOff(setting) ? setting : 'error'
  }
  // Re-bound through `unknown[]`: `Array.isArray` narrows an `unknown` to `any[]`, and reading an
  // element out of that would put an `any` back into the rule table this function exists to keep honest.
  const declared: readonly unknown[] = setting
  return isOff(declared[0]) ? setting : ['error', ...declared.slice(1)]
}

// `object` and `Reflect.get`, rather than an indexable type and a property read. Each preset layer
// arrives as the plugin's own declared interface, and an interface carries no index signature, so
// naming one here would force an assertion at every call site - which the type coverage measurement
// counts as uncovered. What this function needs is one property, read the way an unknown shape is read.
const withoutWarnings = (layer: object): FlatConfigBlock => {
  const rules: unknown = Reflect.get(layer, 'rules')
  return isRuleTable(rules)
    ? {
        ...layer,
        rules: Object.fromEntries(
          Object.entries(rules).map(
            ([id, setting]: readonly [string, unknown]): readonly [string, unknown] => [
              id,
              escalate(setting),
            ],
          ),
        ),
      }
    : { ...layer }
}

/** The preset layers every ploaness-governed project runs, none of which may report at `warn`. */
export const baseLayers: readonly FlatConfigBlock[] = [
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
].map((layer: object): FlatConfigBlock => withoutWarnings(layer))

/**
 * Type-aware parsing, with the caller supplying the parser options its layout needs.
 * @param parserOptions the typescript-eslint parser options.
 * @returns a flat-config block.
 */
export const typeAwareParsing = (
  parserOptions: Readonly<Record<string, unknown>>,
): FlatConfigBlock => ({
  languageOptions: { parserOptions },
})

/** The maximum-explicit rule set: the caps, the explicitness rules, the bans, the mock ban. */
export const guidelineRules: RuleTable = {
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
  // The same conflict, one type narrower, and unsatisfiable rather than merely contrary. For a
  // constant that must carry a string LITERAL type - a discriminant, or a key a typed API indexes by -
  // all three spellings are rejected: `const X: 'a' = 'a'` by this rule, `const X = 'a' as const` and
  // `const X = 'a'` by typedef. There is no legal declaration left, so this one gives way. It arrives
  // from the typescript-eslint preset rather than from this table, which is why it outlived the audit
  // that turned off the rule above.
  '@typescript-eslint/prefer-as-const': 'off',
  '@typescript-eslint/no-non-null-assertion': 'error',
  '@typescript-eslint/strict-boolean-expressions': 'error',
  '@typescript-eslint/switch-exhaustiveness-check': 'error',
  '@typescript-eslint/no-unnecessary-condition': 'error',
  // Defect patterns - bugs the type-checker can prove.
  '@typescript-eslint/no-floating-promises': 'error',
  // The rule above accepts exactly four spellings of a deliberately-discarded promise, and three of
  // them are unavailable in the shape that most often needs one: an async function handed to a
  // SYNCHRONOUS Node callback, which is every `net`/`http` connection listener, `process.on`, and
  // `setInterval`. `await` is impossible in a synchronous callback; `.catch()` and
  // `.then(undefined, fn)` are both reported by `unicorn/prefer-await`, which arrives on by preset.
  // That leaves `void`, which `no-floating-promises` names in its own error text as the marker to
  // use - and Biome's `noVoid` banned it, so a governed project had NO legal spelling at all.
  // `ploaness format` drove a project into the wall rather than around it: ESLint's autofix inserts
  // `void`, and the next Biome pass rejected what it had just written.
  //
  // So `noVoid` is gone from `biome-core.json` and the ban is stated here instead, where it can carry
  // the one exemption that resolves the contradiction. `allowAsStatement` permits `void promise()`
  // standing alone as a statement - the discard position, and the only one the other rule mandates -
  // while `void 0` as an EXPRESSION stays banned, which is the obfuscation both tools were aimed at.
  // A whole rule was not turned off; a rule was narrowed to what it meant, in the tool that can say so.
  'no-void': ['error', { allowAsStatement: true }],
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

  // The two deferred-work markers this rule's own options name are banned outright, and the unicorn
  // rule disabled beneath it arrives ON from the recommended preset and contradicts that: its whole
  // premise is that such a marker is acceptable once it carries an expiry date. The ban has no such
  // exception, so that rule is turned off rather than left to license what this one forbids.
  //
  // Neither marker, and neither is the disabled rule's name, is spelled in this comment. `location:
  // 'anywhere'` scans comment text, so a comment explaining the ban would otherwise report itself -
  // the same self-reference `banned-typography.ts` answers by naming characters as code points.
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
  // receive `doc`). `repository` is exempt for the same kind of reason one layer up: it is the domain
  // term the scope model is built from - a repository holds members, and a rule is repository-scope or
  // package-scope - so every comment, type name and finding string says it. Shortening the identifiers
  // to `repo` would leave the code disagreeing with the prose that explains it.
  // `: false` removes only those replacements; every other abbreviation is still reported.
  'unicorn/name-replacements': [
    'error',
    { replacements: { params: false, req: false, doc: false, repository: false } },
  ],
  // A predicate named as a third-person verb - `matchesAny`, `reachesThreshold`, `declaresKey` -
  // already says plainly what it does, which is what the naming rule asks for. Rewriting those as
  // `isMatchingAny` would make them read worse, so the verb forms are allowed alongside the default
  // prefixes. Every other boolean still has to announce itself as one.
  'unicorn/consistent-boolean-name': [
    'error',
    {
      prefixes: {
        // React mandates it. A hook MUST begin with `use` or React's own rules of hooks do not apply to
        // it, so a boolean-returning hook cannot be renamed to satisfy this rule - the only move left
        // was a suppression on every such hook, spending a project's ceiling on a decision React made.
        use: true,
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
  // The sibling contradiction, resolved the OTHER way, and the difference is worth the paragraph.
  //
  // Building a list by a sequential scan - each entry deciding what it becomes from what the previous
  // ones did - has four spellings, and this harness rejected all of them but one. `[...accumulator,
  // one]` inside a `reduce` is Biome's `noAccumulatingSpread`. `accumulator.concat([one])` is
  // `unicorn/prefer-spread`, which does not merely permit the spread form but MANDATES it over
  // `concat`. `collected.push(one)` is `functional/immutable-data`, and the mutable binding a loop
  // needs is `functional/no-let`. What survived was recursion, which is a poor thing to be steered
  // into: it trades the copying `noAccumulatingSpread` objects to for a hard stack-depth limit, so the
  // rule set was answering a performance question with a correctness cliff.
  //
  // The rule above says Biome decides when the two disagree. That rule is about STYLE - which spelling
  // of a constant, where both spellings do the same thing and the only cost of choosing wrongly is
  // inconsistency. This is not that. `noAccumulatingSpread` is a claim about algorithmic cost, and
  // this harness has already answered that question everywhere else: `functional/no-let` and
  // `functional/immutable-data` price immutability above copying, in every module, by design. A rule
  // penalising the immutable form is arguing with a decision the rule set already made - and
  // `unicorn/no-array-reduce` is off a few lines above precisely because `reduce` is the idiom that
  // decision leaves. So `noAccumulatingSpread` is gone from `biome-core.json`.
  //
  // The lists a governed project accumulates this way are a day's diary entries or a quote's line
  // items. The copying is real and is measured in microseconds; the stack limit is not.
  //
  // `prefer-spread` used to stay as the narrower cut, and it no longer does, for a reason that is not
  // about accumulation at all. See the entry that follows.
  // A THIRD contradiction, and the first one where the fixer is the thing that breaks the code.
  //
  // `unicorn/prefer-spread` mandates `[...value]` over `Array.from(value)` and over `value.split('')`,
  // and it is not type-aware, so it says that about a string too. `@typescript-eslint/no-misused-spread`
  // - from `strictTypeChecked`, and type-aware - bans spreading a string, because `...` iterates code
  // points and decomposes an emoji into its parts. Neither rule can see the other's case, and the
  // unicorn rule has no option to exclude a string.
  //
  // What makes this different from a disagreement is that they meet inside a single `eslint --fix`.
  // The fixer rewrites `Array.from(label)` to `[...label]`, and the same run then reports the text it
  // just wrote. `ploaness format` therefore hands a developer a file it authored and rejects, on a
  // line they did not write, with a message whose suggested repair is a suppression. A contradiction
  // a person can walk around by choosing a different spelling is one thing; one the harness walks
  // INTO on their behalf is another, and it is why this could not be left as guidance.
  //
  // `prefer-spread` yields, and the direction follows the accumulation paragraph above rather than the
  // `Number.NaN` rule before it. That one was about style, where the two spellings do the same thing
  // and only consistency is at stake. This is not: one rule is making a correctness claim about text a
  // CMS stores - a name, a title, an editor's paragraph - out of type information the other one does
  // not have. The uninformed rule does not get to overrule the informed one, and it certainly does not
  // get to do so through a fixer.
  //
  // WHAT THIS COSTS, stated plainly because it reopens a door another spec was built to hold shut.
  // `accumulator.concat([one])` is legal again, so the fold `immutable-accumulation.spec.ts` leaves
  // open is now one good spelling of a sequential scan rather than the only one. The other three doors
  // that spec names are unaffected: `functional/immutable-data` still rejects `push`,
  // `functional/no-let` still rejects the loop binding, and Biome still does not re-ban the fold. The
  // trade is a style guarantee for a correctness one, taken deliberately and in that direction.
  'unicorn/prefer-spread': 'off',
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
  // And require that a block which exists SAYS something. `require-jsdoc` asks only whether a block is
  // present, so `/**\n *\n */` satisfied it while documenting nothing - a check nothing could fail,
  // sitting under a rule whose whole purpose is a documenting comment. A consuming project shipped
  // exactly that stub on a hook and it survived every gate until the file was rewritten for other
  // reasons. This visits blocks that already exist rather than demanding new ones, so it closes the
  // hole without widening the set of symbols that must be documented.
  'jsdoc/require-description': 'error',

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
/**
 * The plugin the block below needs, re-exported so a caller declares no version of its own.
 *
 * Typed as a PLUGIN rather than as a `FlatConfigBlock`, because it is not one: a plugin object carries
 * `meta`, `configs` and `environments`, and ESLint rejects an entire config the moment one of those
 * appears as a top-level entry. Calling it a block is what let `eslint-library.ts` spread it into
 * `compose(...)`, and that config crashed on load for every consumer that used it. The type is derived
 * from the field it has to be assigned to, so it cannot drift from what ESLint accepts there.
 */
export type ESLintPlugin = NonNullable<Linter.Config['plugins']>[string]

export const vitestPlugin: ESLintPlugin = vitest

/** The Vitest half of the test-integrity block, shared by every config that lints a Vitest suite. */
export const testIntegrityRules: RuleTable = {
  'vitest/no-focused-tests': 'error', // ban `.only` - it skips the rest of the suite.
  'vitest/no-disabled-tests': 'error', // ban `.skip` / `xit` / `xdescribe`.
  'vitest/no-commented-out-tests': 'error', // a commented-out test is a deleted test that looks present.
  // a fast-check fc.assert property counts as the assertion too.
  'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'fc.assert'] }],
  // vitest/expect-expect (above) is the assertion-presence gate here and understands fc.assert.
  // sonarjs/assertions-in-tests is a less-configurable duplicate that does not, so it defers in
  // this scope.
  'sonarjs/assertions-in-tests': 'off',
  // `expect` is called correctly (awaited, matcher present). `maxArgs: 2` because Vitest's second
  // argument is the message it prints when the assertion fails, and in a loop or a table-driven case
  // that message is the difference between knowing a case failed and knowing WHICH input broke it. The
  // plugin's default of 1 already waves through a string or template literal there, so what it
  // actually rejected was the identifier form - the one a table-driven case needs.
  'vitest/valid-expect': ['error', { maxArgs: 2 }],
  'vitest/no-standalone-expect': 'error', // assertions must live inside a test.
  'vitest/no-conditional-expect': 'error', // an assertion behind an `if` may never execute.
  'vitest/no-conditional-tests': 'error', // tests must not be defined conditionally.
  'vitest/no-identical-title': 'error', // duplicate titles hide one test behind another.
  'vitest/valid-title': 'error',
  'vitest/no-import-node-test': 'error', // use the Vitest API, not node:test.
  'vitest/consistent-test-it': ['error', { fn: 'it' }],
  'vitest/prefer-hooks-on-top': 'error', // setup before assertions, so reading order matches run order.
}

/**
 * The framework idiom a spec is written in, which the production rules were never aimed at.
 *
 * Only idiom is relaxed. Every rule that carries a rule of the governing standard - the size caps, the
 * explicitness rules, the ban on a non-null assertion, the unsafe-any family - stays ON, because the
 * standard says test code passes the same static-analysis checks as production code. A relaxation that
 * made a test easier to write by making it less checked would exempt the suite from the contract it
 * exists to enforce.
 *
 * Shared by every shipped config rather than stated in each, because what earns the exemption is being a
 * SPEC rather than being a Payload application's spec. Stated twice it drifted: a library consumer's
 * tests were held to the bare-number ban a Payload consumer's were not, and neither config was wrong
 * read on its own, which is why nothing found it for as long as it stood.
 */
export const testIdiomRules: RuleTable = {
  // A test's expected value IS its specification. Naming it moves the specification away from the
  // assertion that reads it, which makes the test harder to check by eye rather than easier - the
  // opposite of what the bare-number ban exists to achieve. This is a role distinction, not a
  // convenience: production code names its constants, and a spec states its literals.
  '@typescript-eslint/no-magic-numbers': 'off',
  'sonarjs/no-duplicate-string': 'off', // fixture data repeats by nature; naming each is noise.
  'unicorn/no-top-level-assignment-in-function': 'off', // the standard vitest beforeAll pattern.
  'unicorn/max-nested-calls': 'off', // expect(fn(arg(value))) assertions are idiomatic.
  'unicorn/numeric-separators-style': 'off', // fixtures use code points (0x2026); ungrouped reads better.
}

// Property tests must stay deterministic: one seed decides the whole suite, and a per-call override
// reintroduces a gate whose verdict changes between two runs of an unchanged repository, which is the
// one thing a check may never do.
//
// Setting that global seed is the project's job, in its own `vitest.setup.ts`. It cannot be done from
// the shipped setup file: that file lives inside node_modules, and a `fast-check` reached from there is
// a different module record from the one the suite loads, so configuring it would configure nothing. The
// message therefore says whose job it is rather than claiming ploaness has already done it.
const NO_FAST_CHECK_SEED: readonly RestrictedSyntax[] = [
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
const NO_NETWORK_GUARD_ESCAPE: readonly RestrictedSyntax[] = [
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
const NO_TEST_ORDER_ESCAPE: readonly RestrictedSyntax[] = [
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
 * Everything a Vitest spec is guarded against, as ONE table.
 *
 * Assembled here rather than at each call site because a block that sets `no-restricted-syntax`
 * REPLACES the setting rather than adding to it. A config listing four of these five has not weakened a
 * rule anybody can read; it has silently dropped the fifth. The library config listed none of them and
 * kept only the inheritance ban it inherited from the guideline layer, so a library's specs could assert
 * a literal against itself, pin their own order, seed a property test per-call, and open a transport the
 * network guard cannot reach - seventeen selectors, none of them Payload-specific.
 *
 * A table rather than the bare setting, so a call site spreads it as it spreads every other table here.
 * Handed out as a setting it has to be re-wrapped under its key at each call site, and that re-wrapping
 * is the replacement - the one move this constant exists to stop anybody making by hand.
 */
export const testSuiteSyntaxRules: RuleTable = {
  'no-restricted-syntax': [
    ...NO_INHERITANCE,
    ...NO_LITERAL_ASSERTIONS,
    ...NO_FAST_CHECK_SEED,
    ...NO_TEST_ORDER_ESCAPE,
    ...NO_NETWORK_GUARD_ESCAPE,
  ],
}

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
export const javascriptBlock = (files: readonly string[]): FlatConfigBlock => ({
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

// The verdict a program returns, which is the process rather than the program's own data.
//
// Assigning it is the ONLY spelling of that verdict this config leaves legal: `unicorn/no-process-exit`
// arrives on by preset, so `process.exit()` is banned too, and with no carve-out here a Node entry point
// cannot report a non-zero exit at all. Every governed `scripts/` therefore paid a suppression for the
// one line it exists to end on - ploaness's own `bin.ts` among them, which is how this was found.
const PROCESS_VERDICT: string = 'process.exitCode'

// The environment, exempt in the setup file alone, because configuring the process before any spec reads
// it is that file's whole job.
//
// ploaness exempts its OWN setup file from this rule and shipped no equivalent, while closing every
// sanctioned alternative a project had: `vi.stubEnv` is banned outright by `NO_MOCK_PROPERTIES`, the
// Vitest config must be a bare re-export so `test.env` cannot be added, and the `tests` gate runs the
// runner directly rather than through a package script that could carry the assignment. A rule that
// reports the only remaining door is aimed at the wrong thing.
const PROCESS_ENVIRONMENT: string = 'process.env.*'

// The global object, exempt in the setup file alone, so a project can supply an API its test runtime
// does not implement.
//
// ploaness MANDATES jsdom for `tests/component/**` - the suite table in `vitest.ts` is not a project's
// to change - and jsdom implements no `matchMedia`, no `ResizeObserver`, no `IntersectionObserver`. A
// component that reads one cannot be rendered until something supplies it, and every way of supplying
// it was closed: `vi.stubGlobal` by `NO_MOCK_PROPERTIES`, `test.environmentOptions` by the Vitest
// config having to be a bare re-export, and both spellings of an assignment by the rules below. The
// harness required an environment and then reported the only means of completing it.
//
// Written WITHOUT a trailing `.*`, which is the whole of the precision here rather than an oversight.
// An accessor pattern matches the path being written, and for `Object.defineProperty(globalThis, ...)`
// that path is the bare argument - so `globalThis` admits the call, while `globalThis.matchMedia = fn`
// keeps the path `globalThis.matchMedia`, matches nothing, and stays reported. That leaves exactly one
// legal spelling, and it is the one `unicorn/no-global-object-property-assignment` already demands: the
// two rules were pointing at each other, one banning the assignment and naming `defineProperty` as its
// fix, the other banning `defineProperty`. Same shape as the `void` marker, resolved the same way.
const RUNTIME_GLOBALS: string = 'globalThis'

// One constructor rather than an option object written at each site. A block that sets this rule REPLACES
// its options rather than adding to them, so the setup file's block has to restate the base carve-out to
// keep it - and restating it by hand is exactly how it would be dropped.
//
// An accessor pattern normalises computed access, so this covers `process.env['TZ']` as well as
// `process.env.TZ`, and neither reaches an unrelated `object.property`.
const immutableData = (accessors: readonly string[]): Linter.RuleEntry => [
  'error',
  { ignoreAccessorPattern: [PROCESS_VERDICT, ...accessors] },
]

/** No `let`, no in-place mutation. The caller supplies the files and the generated-role exemptions. */
export const immutabilityBlock = (
  files: readonly string[],
  ignores: readonly string[],
): FlatConfigBlock => ({
  files,
  ignores,
  plugins: { functional },
  rules: {
    'functional/no-let': 'error',
    'functional/immutable-data': immutableData([]),
  },
})

/**
 * The setup file's role, which is to configure the process rather than to hold program logic.
 *
 * A block of its own rather than a whole-file entry in `immutabilityBlock`'s `ignores`, so the file is
 * still held to `no-let` and to every mutation that is not the environment. ploaness's own exemption is
 * whole-file because installing a guard on `net.Socket.prototype` IS mutation of an existing object; a
 * consumer's setup file needs the environment and nothing more.
 */
export const processConfigBlock = (): FlatConfigBlock => ({
  files: [PROJECT_SETUP_FILE],
  // Mounted here rather than inherited. A setup file sits at the project ROOT, which the source globs of
  // the block above need not reach - this repository's own do not - and a rule whose plugin no matching
  // block defines makes ESLint reject the entire config. The plugin belongs in the block that states the
  // rules naming it, which is the same reason `eslint-library.ts` mounts the Vitest plugin where it does.
  plugins: { functional },
  rules: {
    'functional/immutable-data': immutableData([PROCESS_ENVIRONMENT, RUNTIME_GLOBALS]),
  },
})

/**
 * A spec's need to VARY the environment, which the setup file's carve-out does not cover.
 *
 * The block above admits `process.env` at `vitest.setup.ts`, which configures the process once, before
 * any spec reads it. That is not the same permission a spec needs: a branch taken only when a variable
 * is unset, and another taken only when it is set, cannot both be observed from a value fixed for the
 * whole run. Varying it per case was the missing half, and every mechanism for doing so was banned -
 * `vi.stubEnv` by the mock ban, `test.env` by the Vitest config having to be a bare re-export, and a
 * direct assignment by this rule. Three bans meeting over one need, while the coverage floor still
 * required the branch. Found by a consumer whose endpoint returns 503 with no API key configured, which
 * no legal test could reach.
 *
 * The exemption is the environment and nothing else, so `no-let` and every other in-place mutation still
 * apply to a spec - and it is `tests/**` in both shipped configs rather than the Vitest globs alone,
 * because two configs that disagree about one path are what `eslint-process-scope.spec.ts` exists to
 * catch.
 */
export const specEnvironmentBlock = (): FlatConfigBlock => ({
  files: ['tests/**'],
  // Mounted for the reason the block above states: a rule whose plugin no matching block defines makes
  // ESLint reject the entire config.
  plugins: { functional },
  rules: {
    'functional/immutable-data': immutableData([PROCESS_ENVIRONMENT]),
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
