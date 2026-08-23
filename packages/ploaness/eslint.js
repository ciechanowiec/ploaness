// Consumers reference `ploaness/eslint`, never `@ploaness/config` directly. Under the strict pnpm layout
// a scoped package that is only a transitive dependency is not resolvable from the consumer, so every
// consumer-facing entry point is re-exported from this package, which is the one they declare.
export { default } from '@ploaness/config/eslint'
