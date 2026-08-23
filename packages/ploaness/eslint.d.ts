// See vitest.d.ts: a consumer's eslint.config.mjs re-exports this value, so it must carry a type. A flat
// ESLint config is an array of config objects; typing it structurally avoids depending on `eslint` being
// resolvable from this package.
declare const config: readonly Record<string, unknown>[]
export default config
