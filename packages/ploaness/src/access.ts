// See eslint.ts for why every entry point is re-exported through this package.
//
// The TYPES are re-exported, not merely relied on for the constant's own type. A governed project must
// annotate, so a type the managed access-boundary sweep has to name is part of this entry point's
// surface rather than an implementation detail of it. Exporting only the constant left the sweep unable
// to name what it was given, and nothing here could see that: the asset-body check runs Biome, which
// carries no type information, and ploaness has no Payload application to compile the spec against. A
// consumer's `types` gate reported it first.

export { type AccessReport, PUBLIC_ACCESS, undeclaredGrants } from '@ploaness/config/access'
export type { PublicAccess } from '@ploaness/governance'
