// A consumer's vitest.config.mts re-exports this value, so it is read by the project's own type-check
// (and by `next build`, which type-checks every file it can see). Without a declaration the import is an
// implicit `any` and the build fails under `noImplicitAny`.
//
// The type is deliberately structural rather than Vitest's own `UserConfig`: importing that here would
// require `vitest` to be resolvable from this package, which it is not - the harness owns the config, the
// consumer owns the runner. A structural shape is enough for a file that only re-exports the value.
declare const config: Record<string, unknown>
export default config
