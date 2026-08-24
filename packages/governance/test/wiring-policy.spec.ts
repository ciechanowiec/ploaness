import { describe, expect, it } from 'vitest'
import { extractLiteralSourcePaths } from '../src/config-references.js'
import {
  findWiringViolations,
  REQUIRED_SCRIPTS,
  REQUIRED_TSCONFIG_PATHS,
  requiredBiomeFiles,
  type WiringInputs,
  type WiringViolation,
  type WorkflowFile,
} from '../src/wiring-policy.js'

const BIOME_FILES: Readonly<Record<string, unknown>> = requiredBiomeFiles([
  'src',
  'tests',
  'scripts',
])

const WIRED_PACKAGE_JSON: Record<string, unknown> = {
  devDependencies: { ploaness: '1.0.0', vitest: '4.1.11' },
  scripts: { ...REQUIRED_SCRIPTS },
}

const wiredInputs = (overrides: Record<string, unknown> = {}): WiringInputs => ({
  packageJson: WIRED_PACKAGE_JSON,
  eslintConfig: "import ploaness from 'ploaness/eslint'\n\nexport default ploaness\n",
  vitestConfig: "import ploaness from 'ploaness/vitest'\n\nexport default ploaness\n",
  workspaceFile: '',
  biomeConfig: JSON.stringify({ extends: ['ploaness/biome'], files: BIOME_FILES }),
  tsconfig: JSON.stringify({
    extends: 'ploaness/tsconfig.json',
    compilerOptions: { paths: {} },
    ...REQUIRED_TSCONFIG_PATHS,
  }),
  workflows: [{ name: 'verify.yml', content: 'run: ploaness verify --extended' }],
  expectedTestLibraries: { vitest: '4.1.11' },
  requiredBiomeFiles: BIOME_FILES,
  ...overrides,
})

const locations = (inputs: Parameters<typeof findWiringViolations>[0]): readonly string[] =>
  findWiringViolations(inputs).map((violation) => violation.location)

describe('a correctly wired project', () => {
  it('reports nothing', () => {
    expect(findWiringViolations(wiredInputs())).toEqual([])
  })
})

describe('script tampering', () => {
  it('catches a neutered verify script', () => {
    const packageJson: Record<string, unknown> = {
      ...WIRED_PACKAGE_JSON,
      scripts: { ...REQUIRED_SCRIPTS, verify: 'echo ok' },
    }
    expect(locations(wiredInputs({ packageJson }))).toContain('package.json scripts.verify')
  })

  it('catches a missing verify:full script', () => {
    const { 'verify:full': _dropped, ...scripts } = REQUIRED_SCRIPTS
    expect(locations(wiredInputs({ packageJson: { ...WIRED_PACKAGE_JSON, scripts } }))).toContain(
      'package.json scripts.verify:full',
    )
  })
})

describe('config tampering', () => {
  it('catches rules appended after the harness ESLint config', () => {
    const eslintConfig: string = [
      "import ploaness from 'ploaness/eslint'",
      '',
      "export default [...ploaness, { rules: { 'no-explicit-any': 'off' } }]",
    ].join('\n')
    expect(locations(wiredInputs({ eslintConfig }))).toContain('eslint.config.mjs')
  })

  it('catches a Biome section the project redeclares', () => {
    const biomeConfig: string = JSON.stringify({
      extends: ['ploaness/biome'],
      files: BIOME_FILES,
      linter: { enabled: false },
    })
    expect(locations(wiredInputs({ biomeConfig }))).toContain('biome.json linter')
  })

  it('catches a compiler option the project overrides', () => {
    const tsconfig: string = JSON.stringify({
      extends: 'ploaness/tsconfig.json',
      compilerOptions: { strict: false },
      ...REQUIRED_TSCONFIG_PATHS,
    })
    expect(locations(wiredInputs({ tsconfig }))).toContain('tsconfig.json compilerOptions.strict')
  })

  it('allows paths, which a project legitimately owns', () => {
    const tsconfig: string = JSON.stringify({
      extends: 'ploaness/tsconfig.json',
      compilerOptions: { paths: { '@/*': ['./src/*'] } },
      ...REQUIRED_TSCONFIG_PATHS,
    })
    expect(findWiringViolations(wiredInputs({ tsconfig }))).toEqual([])
  })
})

describe('CI and dependencies', () => {
  it('catches extended verification missing from CI', () => {
    const workflows: readonly WorkflowFile[] = [
      { name: 'verify.yml', content: 'run: pnpm run lint' },
    ]
    expect(locations(wiredInputs({ workflows }))).toContain('.github/workflows')
  })

  it('accepts CI invoking the owned script instead of the raw command', () => {
    const workflows: readonly WorkflowFile[] = [
      { name: 'verify.yml', content: 'run: pnpm run verify:full' },
    ]
    expect(findWiringViolations(wiredInputs({ workflows }))).toEqual([])
  })

  it('catches a missing harness dependency', () => {
    const packageJson: Record<string, unknown> = {
      ...WIRED_PACKAGE_JSON,
      devDependencies: { vitest: '4.1.11' },
    }
    expect(locations(wiredInputs({ packageJson }))).toContain('package.json')
  })

  it('catches a test library pinned to the wrong version', () => {
    const packageJson: Record<string, unknown> = {
      ...WIRED_PACKAGE_JSON,
      devDependencies: { ploaness: '1.0.0', vitest: '3.0.0' },
    }
    expect(locations(wiredInputs({ packageJson }))).toContain('package.json devDependencies.vitest')
  })
})

describe('the Biome file-selection block', () => {
  it('catches a project that drops it, which would make Biome check the whole tree', () => {
    const biomeConfig: string = JSON.stringify({ extends: ['ploaness/biome'] })
    expect(locations(wiredInputs({ biomeConfig }))).toContain('biome.json files')
  })

  it('catches a project that widens it', () => {
    const biomeConfig: string = JSON.stringify({
      extends: ['ploaness/biome'],
      files: { ...BIOME_FILES, includes: ['src/**/*'] },
    })
    expect(locations(wiredInputs({ biomeConfig }))).toContain('biome.json files')
  })
})

describe('the tsconfig path keys', () => {
  it('catches a project that omits include, which would make tsc walk the harness package', () => {
    const tsconfig: string = JSON.stringify({
      extends: 'ploaness/tsconfig.json',
      exclude: ['node_modules'],
    })
    expect(locations(wiredInputs({ tsconfig }))).toContain('tsconfig.json include')
  })

  it('catches a project that narrows exclude', () => {
    const tsconfig: string = JSON.stringify({
      ...REQUIRED_TSCONFIG_PATHS,
      extends: 'ploaness/tsconfig.json',
      exclude: [],
    })
    expect(locations(wiredInputs({ tsconfig }))).toContain('tsconfig.json exclude')
  })
})

// The config-references gate exempts any carve-out this policy mandates, and it derives that exemption
// set by extracting the literal paths back out of the block. Both halves have to keep agreeing: a
// mandated carve-out the extractor cannot see would be reported as the project's dangling reference,
// and the project is forbidden to remove it. That combination fails a project for obeying the harness,
// which is what a Payload project that has not generated its types yet would hit on its first run.
describe('the carve-outs a consumer is required to keep', () => {
  it('are all recoverable from the mandated block, so the dangling-reference gate can exempt them', () => {
    const mandated: readonly string[] = extractLiteralSourcePaths(JSON.stringify(BIOME_FILES))
    expect(mandated).toContain('src/payload-types.ts')
  })
})

// The "missing file" branch of each config check. A project that deletes a project file must be told
// which file to restore, not merely that something is wrong.
describe('a project file that is absent entirely', () => {
  it.each([
    ['eslint.config.mjs', 'eslintConfig'],
    ['biome.json', 'biomeConfig'],
    ['tsconfig.json', 'tsconfig'],
  ])('names %s when it is missing', (expected: string, key: string) => {
    const violations: readonly WiringViolation[] = findWiringViolations(
      wiredInputs({ [key]: undefined }),
    )
    expect(violations.some((violation: WiringViolation) => violation.location === expected)).toBe(
      true,
    )
  })

  it('reports a test library the project never declared', () => {
    const packageJson: Record<string, unknown> = {
      ...WIRED_PACKAGE_JSON,
      devDependencies: { ploaness: '1.0.0' },
    }
    const violations: readonly WiringViolation[] = findWiringViolations(
      wiredInputs({ packageJson }),
    )
    expect(
      violations.some((violation: WiringViolation) =>
        violation.reason.includes('specs import it directly'),
      ),
    ).toBe(true)
  })
})

const workflowNamed = (content: string): readonly WorkflowFile[] => [
  { name: 'verify.yml', content },
]

// A workflow that runs verification but neuters it is worse than one that never ran it: the project is
// green forever, and the harness reports that the wiring is intact.
describe('a workflow that neuters verification', () => {
  it('rejects a verification run in report-only mode', () => {
    const workflows: readonly WorkflowFile[] = workflowNamed(
      'jobs:\n  verify:\n    steps:\n      - run: ploaness verify --extended --enforce=false\n',
    )
    const reasons: readonly string[] = findWiringViolations(wiredInputs({ workflows })).map(
      (violation: WiringViolation): string => violation.reason,
    )
    expect(reasons.some((reason: string) => reason.includes('not a pass'))).toBe(true)
  })

  it('rejects continue-on-error on the step that runs verification', () => {
    const workflows: readonly WorkflowFile[] = workflowNamed(
      'jobs:\n  verify:\n    steps:\n      - name: Verify\n' +
        '        continue-on-error: true\n        run: ploaness verify --extended\n',
    )
    const reasons: readonly string[] = findWiringViolations(wiredInputs({ workflows })).map(
      (violation: WiringViolation): string => violation.reason,
    )
    expect(reasons.some((reason: string) => reason.includes('continue-on-error'))).toBe(true)
  })

  it('leaves continue-on-error alone on a step that does not run verification', () => {
    const workflows: readonly WorkflowFile[] = workflowNamed(
      'jobs:\n  verify:\n    steps:\n      - name: Upload\n' +
        '        continue-on-error: true\n        run: echo upload\n' +
        '      - run: ploaness verify --extended\n',
    )
    expect(findWiringViolations(wiredInputs({ workflows }))).toEqual([])
  })

  // A mention in a comment used to satisfy the requirement, because the whole file was searched as one
  // string rather than line by line.
  it('does not accept an invocation that only appears in a comment', () => {
    const workflows: readonly WorkflowFile[] = workflowNamed(
      'jobs:\n  verify:\n    steps:\n      # run: ploaness verify --extended\n' +
        '      - run: echo nothing\n',
    )
    const locations: readonly string[] = findWiringViolations(wiredInputs({ workflows })).map(
      (violation: WiringViolation): string => violation.location,
    )
    expect(locations).toContain('.github/workflows')
  })

  it('accepts a workflow that runs verification plainly', () => {
    const workflows: readonly WorkflowFile[] = workflowNamed(
      'jobs:\n  verify:\n    steps:\n      - run: pnpm run verify:full\n',
    )
    expect(findWiringViolations(wiredInputs({ workflows }))).toEqual([])
  })
})

// This file was seeded by `init` and then read by nothing, while the tests gate runs the project's
// vitest against it - so the coverage thresholds could be dropped without a single finding.
describe('the vitest config', () => {
  it('rejects a config that is not the bare re-export', () => {
    const vitestConfig: string =
      "import { defineConfig } from 'vitest/config'\n\n" +
      'export default defineConfig({ test: { coverage: { enabled: false } } })\n'
    const locations: readonly string[] = findWiringViolations(wiredInputs({ vitestConfig })).map(
      (violation: WiringViolation): string => violation.location,
    )
    expect(locations).toContain('vitest.config.mts')
  })

  it('rejects a config that re-exports and then adds to it', () => {
    const vitestConfig: string =
      "import ploaness from 'ploaness/vitest'\n\n" +
      'export default { ...ploaness, test: { coverage: { thresholds: {} } } }\n'
    const locations: readonly string[] = findWiringViolations(wiredInputs({ vitestConfig })).map(
      (violation: WiringViolation): string => violation.location,
    )
    expect(locations).toContain('vitest.config.mts')
  })

  it('reports the file as missing when it is absent', () => {
    const reasons: readonly string[] = findWiringViolations(
      wiredInputs({ vitestConfig: undefined }),
    ).map((violation: WiringViolation): string => violation.reason)
    expect(reasons.some((reason: string) => reason.includes('missing'))).toBe(true)
  })
})

// A pinned version is only a pin while nothing else can change it.
describe('install configuration that undoes a pin', () => {
  it('rejects an override that redefines a pinned package', () => {
    const workspaceFile: string = ['overrides:', "  vitest: '3.0.0'"].join('\n')
    const locations: readonly string[] = findWiringViolations(wiredInputs({ workspaceFile })).map(
      (violation: WiringViolation): string => violation.location,
    )
    expect(locations).toContain('pnpm-workspace.yaml overrides.vitest')
  })

  // A pre-publication consumer points the ploaness packages at local tarballs; ploaness does not pin
  // its own version through this mechanism, so that override must keep working.
  it('leaves an override for a package ploaness does not pin alone', () => {
    const workspaceFile: string = [
      'overrides:',
      '  deepmerge-ts: "^8.0.2"',
      '  ploaness: "file:../ploaness/dist-tarballs/ploaness-1.0.0.tgz"',
    ].join('\n')
    expect(findWiringViolations(wiredInputs({ workspaceFile }))).toEqual([])
  })

  it('rejects an audit configuration that silences the vulnerability gate', () => {
    const packageJson: Record<string, unknown> = {
      ...WIRED_PACKAGE_JSON,
      pnpm: { auditConfig: { ignoreGhsas: ['GHSA-1'] } },
    }
    const reasons: readonly string[] = findWiringViolations(wiredInputs({ packageJson })).map(
      (violation: WiringViolation): string => violation.reason,
    )
    expect(reasons.some((reason: string) => reason.includes('vulnerabilityAllowlist'))).toBe(true)
  })
})
