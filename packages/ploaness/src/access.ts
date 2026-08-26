// See eslint.ts for why every entry point is re-exported through this package.
//
// The entry type is RE-EXPORTED, not merely relied on for the constant's own type. The managed
// access-boundary sweep annotates the callback it passes to `.some`, because a governed project must,
// so `PublicAccess` is part of this entry point's surface rather than an implementation detail of it.
// Exporting only the constant left the sweep unable to name the thing it was given, and nothing here
// could see that: the asset-body check runs Biome, which carries no type information, and ploaness has
// no Payload application to compile the spec against. A consumer's `types` gate reported it first.

export { PUBLIC_ACCESS } from '@ploaness/config/access'
export type { PublicAccess } from '@ploaness/governance'
