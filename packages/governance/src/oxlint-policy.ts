import { JSX_ACCESSIBILITY_RULES, type JsxAccessibilityRule } from './jsx-accessibility.js'

/** A native rule with explicit semantic options, independent of the host application's framework. */
export interface OxlintRule {
  readonly oxlint: string
  readonly options?: Readonly<Record<string, unknown>>
}

/** Validated gaps in the existing analyzer coverage; equivalent rules retain their current owner. */
export const OXLINT_CORE_RULES: readonly OxlintRule[] = [
  { oxlint: 'eslint/no-promise-executor-return', options: { allowVoid: false } },
  {
    oxlint: 'import/no-absolute-path',
    options: { esmodule: true, commonjs: false, amd: false },
  },
]

/** The rules applicable to one disjoint file group. */
export const oxlintRules = (hasAccessibility: boolean): readonly OxlintRule[] => [
  ...OXLINT_CORE_RULES,
  ...(hasAccessibility ? JSX_ACCESSIBILITY_RULES : []),
]

/** Canonical native names, also used to validate a file's suppression comments. */
export const oxlintRuleNames = (rules: readonly OxlintRule[]): readonly string[] =>
  rules.map((rule: OxlintRule): string => rule.oxlint)

/** Build a closed rule set; category defaults cannot add undeclared checks. */
export const oxlintConfig = (rules: readonly OxlintRule[]): Readonly<Record<string, unknown>> => ({
  plugins: ['import', 'jsx-a11y'],
  categories: { correctness: 'off' },
  rules: Object.fromEntries(
    rules.map((rule: OxlintRule): readonly [string, unknown] => [
      rule.oxlint,
      rule.options === undefined ? 'error' : ['error', rule.options],
    ]),
  ),
})

/** Retained accessibility-only defaults for existing suppression API callers. */
export const OXLINT_ACCESSIBILITY_NAMES: readonly string[] = JSX_ACCESSIBILITY_RULES.map(
  (rule: JsxAccessibilityRule): string => rule.oxlint,
)
