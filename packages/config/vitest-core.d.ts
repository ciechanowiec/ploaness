// Declared rather than inferred, because the ploaness repository's own Vitest config is TypeScript and
// sits in a project the type-aware lint pass reads. Same role as packages/ploaness/vitest.d.ts.
export declare const PROPERTY_TEST_SEED: number
export declare const harnessSetupFile: () => string
export declare const projectSetupFiles: () => readonly string[]
export declare const DETERMINISTIC_SEQUENCE: {
  readonly shuffle: { readonly files: boolean; readonly tests: boolean }
  readonly seed: number
  readonly concurrent: boolean
  readonly hooks: 'stack'
  readonly setupFiles: 'list'
}
