// The managed access-boundary sweep imports this, and the consumer type-checks that spec at full
// strictness, so the shape has to be declared rather than inferred from a JavaScript file.
//
// The entry type is imported rather than restated: `@ploaness/governance` is a declared dependency of
// this package, and a second copy of a shape the harness already owns is the drift this repository
// spends most of its rules preventing.
import type { PublicAccess } from '@ploaness/governance'

export declare const PUBLIC_ACCESS: readonly PublicAccess[]
