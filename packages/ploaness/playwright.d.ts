// See vitest.d.ts: a consumer's playwright.config.ts re-exports this value, so it is read by the
// project's own type-check and must carry a type. The shape is structural rather than Playwright's own
// `PlaywrightTestConfig` for the same reason it is there - the harness owns the config, the consumer
// owns the runner, and typing it structurally keeps this package from having to resolve one.
declare const config: Record<string, unknown>
export default config
