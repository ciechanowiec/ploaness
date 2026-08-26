// eslint-plugin-jsx-a11y ships no type declarations, and no `@types/` package exists for it.
//
// Declared here rather than left implicitly `any`, because `any` would flow into the composed config and
// defeat the check on every block after it. Only the surface `eslint.ts` actually reads is named:
// `recommended` is spelled out rather than reached through an index signature, so the property access
// stays legal under `noPropertyAccessFromIndexSignature`.
declare module 'eslint-plugin-jsx-a11y' {
  import type { ESLint, Linter } from 'eslint'

  const plugin: ESLint.Plugin & {
    readonly flatConfigs: {
      readonly recommended: { readonly rules: Partial<Linter.RulesRecord> }
    }
  }
  export default plugin
}
