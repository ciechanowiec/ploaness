// Declared rather than inferred, for the reason vitest-core.d.ts is: a spec in a project the type-aware
// lint pass reads imports this, and a JavaScript module carries no type information for that pass.
import type { Settings } from '@ploaness/governance'

export declare const projectSettings: Settings
