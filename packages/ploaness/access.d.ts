// The managed access-boundary sweep imports this, and the consumer type-checks that spec at full
// strictness, so the shape has to be declared rather than inferred from a JavaScript file.
//
// The entry type is imported rather than restated: `@ploaness/governance` is a declared dependency of
// this package, and a second copy of a shape the harness already owns is the drift this repository
// spends most of its rules preventing.
//
// It is also RE-EXPORTED, not merely imported for the constant's own type. The sweep annotates the
// callback it passes to `.some`, because a governed project must, so the type is part of this entry
// point's surface rather than an implementation detail of it. Declaring only the constant left the
// sweep unable to name the thing it was given, and nothing in this repository could see that: the
// asset-body check runs Biome, which formats without type information, and ploaness has no Payload
// application to compile the spec against. A consumer's `types` gate reported it on the first run.
import type { PublicAccess } from '@ploaness/governance'

export type { PublicAccess }

export declare const PUBLIC_ACCESS: readonly PublicAccess[]
