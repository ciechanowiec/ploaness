// Exercise additions to the shared preset through the rules each shipped configuration resolves.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint, Linter } from 'eslint'
import unicorn from 'eslint-plugin-unicorn'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
import payloadConfig from '../dist/eslint.js'
import libraryConfig from '../dist/eslint-library.js'

interface Example {
  readonly rule: string
  readonly invalid: string
  readonly valid: string
}

const examples: readonly Example[] = [
  {
    rule: 'unicorn/no-async-iterator-callback',
    invalid: 'const result = Iterator.from([1]).filter(async value => value > 0);',
    valid: 'const result = Iterator.from([1]).filter(value => value > 0);',
  },
  {
    rule: 'unicorn/no-unused-iterator-helper',
    invalid: 'Iterator.from([1]).map(value => value);',
    valid: 'const result = Iterator.from([1]).map(value => value);',
  },
  {
    rule: 'unicorn/no-useless-set-construction',
    invalid: 'const result = new Set(new Set([1]).union(new Set([2])));',
    valid: 'const result = new Set([1]).union(new Set([2]));',
  },
  {
    rule: 'unicorn/no-using-resource-escape',
    invalid: 'function acquire() { using handle = open(); return handle; }',
    valid: 'function acquire() { using handle = open(); consume(handle); }',
  },
  {
    rule: 'unicorn/prefer-combined-guards',
    invalid: 'function check(first, second) { if (first) { return; } if (second) { return; } consume(); }',
    valid: 'function check(first, second) { if (first || second) { return; } consume(); }',
  },
  {
    rule: 'unicorn/prefer-temporal-conversion',
    invalid:
      'const value = Temporal.PlainDateTime.from("2026-10-01T10:00"); const result = Temporal.PlainDate.from(value);',
    valid: 'const value = Temporal.PlainDateTime.from("2026-10-01T10:00"); const result = value.toPlainDate();',
  },
  {
    rule: 'unicorn/no-conflicting-constraints',
    invalid: 'const view = <input type="number" min={10} max={5} />;',
    valid: 'const view = <input type="number" min={5} max={10} />;',
  },
  {
    rule: 'unicorn/no-incomplete-accessor-override',
    invalid:
      'class Base { get value() { return 1; } set value(input) { consume(input); } } ' +
      'class Child extends Base { get value() { return 2; } }',
    valid: 'class Base { get value() { return 1; } } class Child extends Base { get value() { return 2; } }',
  },
  {
    rule: 'unicorn/no-ineffective-csp-directives',
    invalid: 'const view = <meta httpEquiv="Content-Security-Policy" content="frame-ancestors none" />;',
    valid: 'const view = <meta httpEquiv="Content-Security-Policy" content="default-src none" />;',
  },
  {
    rule: 'unicorn/no-invalid-boolean-attribute-value',
    invalid: 'const button = document.createElement("button"); button.setAttribute("disabled", "false");',
    valid: 'const button = document.createElement("button"); button.removeAttribute("disabled");',
  },
  {
    rule: 'unicorn/no-invalid-dom-token',
    invalid: 'element.classList.add("first second");',
    valid: 'element.classList.add("first", "second");',
  },
  {
    rule: 'unicorn/no-invalid-integrity',
    invalid: 'const view = <script integrity="sha256-invalid" />;',
    valid: 'const view = <script integrity="sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" />;',
  },
  {
    rule: 'unicorn/no-invalid-intl-options',
    invalid: 'const format = new Intl.NumberFormat("en", { style: "currency" });',
    valid: 'const format = new Intl.NumberFormat("en", { style: "currency", currency: "USD" });',
  },
  {
    rule: 'unicorn/no-invalid-property-descriptor',
    invalid: 'Object.defineProperty(target, "value", { value: 1, get() { return 1; } });',
    valid: 'Object.defineProperty(target, "value", { value: 1, writable: false });',
  },
  {
    rule: 'unicorn/no-invalid-response-options',
    invalid: 'const response = new Response("body", { status: 204 });',
    valid: 'const response = new Response(undefined, { status: 204 });',
  },
  {
    rule: 'unicorn/no-invalid-style-set-property',
    invalid: 'element.style.setProperty("color", "red", "urgent");',
    valid: 'element.style.setProperty("color", "red", "important");',
  },
  {
    rule: 'unicorn/no-invalid-temporal-arithmetic',
    invalid: 'const value = Temporal.Instant.from("2026-10-01T10:00Z").add({ days: 1 });',
    valid: 'const value = Temporal.Instant.from("2026-10-01T10:00Z").add({ hours: 24 });',
  },
  {
    rule: 'unicorn/no-invalid-url-protocol-comparison',
    invalid: 'const address = new URL("https://example.com"); const secure = address.protocol === "https";',
    valid: 'const address = new URL("https://example.com"); const secure = address.protocol === "https:";',
  },
  {
    rule: 'unicorn/no-prevent-default-in-passive-listener',
    invalid: 'element.addEventListener("wheel", event => { event.preventDefault(); }, { passive: true });',
    valid: 'element.addEventListener("wheel", event => { event.preventDefault(); }, { passive: false });',
  },
  {
    rule: 'unicorn/no-unnecessary-parameters',
    invalid: 'function label(value) { consume(value); } label("same"); label("same");',
    valid: 'function label(value) { consume(value); } label("first"); label("second");',
  },
  {
    rule: 'unicorn/no-unsafe-json-serialization',
    invalid: 'const encoded = JSON.stringify({ value: 1n });',
    valid: 'const encoded = JSON.stringify({ value: "1" });',
  },
  {
    rule: 'unicorn/no-url-in-search-params',
    invalid: 'const query = new URLSearchParams("https://example.com/?value=1");',
    valid: 'const query = new URL("https://example.com/?value=1").searchParams;',
  },
  {
    rule: 'unicorn/prefer-escaped-irregular-whitespace',
    invalid: 'const value = "first' + String.fromCodePoint(0xa0) + 'second";',
    valid: String.raw`const value = "first\u00A0second";`,
  },
  {
    rule: 'unicorn/prefer-literal-ascii',
    invalid: String.raw`const value = "\u0041";`,
    valid: 'const value = "A";',
  },
  {
    rule: 'unicorn/prefer-promise-static-methods',
    invalid: 'const result = new Promise(resolve => { resolve(1); });',
    valid: 'const result = Promise.resolve(1);',
  },
  {
    rule: 'unicorn/prefer-short-escape-sequences',
    invalid: String.raw`const value = "\u0009";`,
    valid: String.raw`const value = "\t";`,
  },
  {
    rule: 'unicorn/require-text-decoder-streaming',
    invalid:
      'const response = await fetch(address); const decoder = new TextDecoder(); ' +
      'for await (const chunk of response.body) { consume(decoder.decode(chunk)); }',
    valid:
      'const response = await fetch(address); const decoder = new TextDecoder(); ' +
      'for await (const chunk of response.body) { consume(decoder.decode(chunk, { stream: true })); } ' +
      'consume(decoder.decode());',
  },
]

const packageRoot: string = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const configurations: Readonly<Record<string, readonly Linter.Config[]>> = {
  payload: payloadConfig,
  library: libraryConfig,
}

const rulesFor = async (config: readonly Linter.Config[], filePath: string): Promise<Partial<Linter.RulesRecord>> => {
  const eslint: ESLint = new ESLint({
    overrideConfigFile: true,
    baseConfig: [...config],
    cwd: packageRoot,
  })
  const resolved: unknown = await eslint.calculateConfigForFile(filePath)
  const rules: Partial<Linter.RulesRecord> | undefined = (resolved as Linter.Config | undefined)?.rules
  if (rules === undefined) {
    throw new TypeError('The shipped source configuration resolved to no rules')
  }
  return rules
}

const rulesByConfig: Readonly<Record<string, Partial<Linter.RulesRecord>>> = Object.fromEntries(
  await Promise.all(
    Object.entries(configurations).flatMap(([name, config]: [string, readonly Linter.Config[]]) =>
      ['src/lib/example.ts', 'src/lib/example.tsx'].map(
        async (filePath: string): Promise<readonly [string, Partial<Linter.RulesRecord>]> => [
          `${name} ${filePath}`,
          await rulesFor(config, filePath),
        ],
      ),
    ),
  ),
)

const messagesFor = (code: string, rule: string, rules: Partial<Linter.RulesRecord>): readonly Linter.LintMessage[] =>
  new Linter().verify(code, {
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { unicorn },
    rules: { [rule]: rules[rule] ?? 'off' },
  })

for (const [name, rules] of Object.entries(rulesByConfig)) {
  describe(`${name} preset additions`, () => {
    it.each(examples)('rejects the defect covered by $rule at error severity', (example: Example) => {
      expect(
        messagesFor(example.invalid, example.rule, rules).map(
          (message: Linter.LintMessage): readonly [string | null, number] => [message.ruleId, message.severity],
        ),
      ).toEqual([[example.rule, 2]])
    })

    it.each(examples)('accepts valid code beside $rule', (example: Example) => {
      expect(messagesFor(example.valid, example.rule, rules)).toEqual([])
    })

    it.each(examples)('honors a narrow source suppression for $rule', (example: Example) => {
      const suppressed: string =
        '// eslint-disable-next-line ' + example.rule + ' -- Exercises the narrow source exception.\n' + example.invalid
      expect(messagesFor(suppressed, example.rule, rules)).toEqual([])
    })
  })
}

const ZIP_RULE: string = 'unicorn/prefer-iterator-zip'
const PARALLEL_ARRAYS: string =
  'const left = [1]; const right = [1]; ' +
  'for (let index = 0; index < Math.min(left.length, right.length); index++) ' +
  '{ consume(left[index], right[index]); }'

describe('parallel iteration on the supported platform', () => {
  it('establishes that the upstream rule requires the unavailable Iterator.zip method', () => {
    expect(
      messagesFor(PARALLEL_ARRAYS, ZIP_RULE, { [ZIP_RULE]: 'error' }).map(
        (message: Linter.LintMessage): string | null => message.ruleId,
      ),
    ).toEqual([ZIP_RULE])
  })

  it.each(Object.keys(rulesByConfig))('keeps parallel indexing legal in %s', (name: string) => {
    const rules: Partial<Linter.RulesRecord> = rulesByConfig[name] ?? {}
    expect(messagesFor(PARALLEL_ARRAYS, ZIP_RULE, rules)).toEqual([])
  })
})

const DOCUMENTATION_STYLE: string = 'unicorn/no-asterisk-prefix-in-documentation-comments'
const DOCUMENTED_EXPORT: string = '/**\n * The stable resource label.\n */\nexport const label = "resource";'

describe('formatter ownership', () => {
  it('establishes that the upstream layout rule rejects the existing documentation style', () => {
    expect(messagesFor(DOCUMENTED_EXPORT, DOCUMENTATION_STYLE, { [DOCUMENTATION_STYLE]: 'error' })).toHaveLength(1)
  })

  it.each(Object.keys(rulesByConfig))('preserves formatted documentation in %s', (name: string) => {
    expect(messagesFor(DOCUMENTED_EXPORT, DOCUMENTATION_STYLE, rulesByConfig[name] ?? {})).toEqual([])
  })
})

describe('application generated source', () => {
  it.each(['src/payload-types.ts', '.next/types/app/page.ts'])(
    'keeps the framework-owned path %s outside the application lint pass',
    async (filePath: string) => {
      const eslint: ESLint = new ESLint({
        overrideConfigFile: true,
        baseConfig: [...payloadConfig],
        cwd: packageRoot,
      })
      expect(await eslint.isPathIgnored(filePath)).toBe(true)
    },
  )
})
