import { describe, expect, it } from 'vitest'
import { extractLiteralSourcePaths } from '../src/config-references.js'
import {
  findWiringViolations,
  REQUIRED_SCRIPTS,
  REQUIRED_TSCONFIG_PATHS,
  requiredBiomeFiles,
  type WiringInputs,
} from '../src/wiring-policy.js'
import type { WiringViolation } from '../src/wiring-violation.js'

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
  playwrightConfig: "import ploaness from 'ploaness/playwright'\n\nexport default ploaness\n",
  workspaceFile: '',
  declaredExclusions: [],
  biomeConfig: JSON.stringify({ extends: ['ploaness/biome'], files: BIOME_FILES }),
  tsconfig: JSON.stringify({
    extends: 'ploaness/tsconfig.json',
    compilerOptions: { paths: {} },
    ...REQUIRED_TSCONFIG_PATHS,
  }),
  expectedTestLibraries: { vitest: '4.1.11', jsdom: '30.0.1' },
  requiredTestLibraries: new Set<string>(['vitest']),
  payloadVersion: undefined,
  requiredPackageManager: undefined,
  requiredEngines: {},
  requiredBiomeFiles: BIOME_FILES,
  ...overrides,
})

const locations = (inputs: Parameters<typeof findWiringViolations>[0]): readonly string[] =>
  findWiringViolations(inputs).map((violation) => violation.location)

const reasonFor = (inputs: Parameters<typeof findWiringViolations>[0], location: string): string =>
  findWiringViolations(inputs).find((violation) => violation.location === location)?.reason ?? ''

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

describe('dependencies', () => {
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

  // The assertion is on an absence because the defect was one: `init` seeds a stub only where the
  // project has no biome.json, and this finding is unreachable until biome.json has parsed. Naming
  // that command sent a real consumer round a loop - run it, watch it report the file left alone,
  // fail on the same line - which is what `sync.ts` refuses to do for a managed file.
  it('does not instruct running init, which leaves an existing file alone', () => {
    const biomeConfig: string = JSON.stringify({ extends: ['ploaness/biome'] })
    expect(reasonFor(wiredInputs({ biomeConfig }), 'biome.json files')).not.toContain(
      'run `ploaness init`',
    )
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

  // The same loop the biome block above was sending a project round: unreachable until tsconfig.json
  // has parsed, so the file it told the project to have written already exists.
  it('does not instruct running init, which leaves an existing file alone', () => {
    const tsconfig: string = JSON.stringify({
      extends: 'ploaness/tsconfig.json',
      exclude: ['node_modules'],
    })
    expect(reasonFor(wiredInputs({ tsconfig }), 'tsconfig.json include')).not.toContain(
      'run `ploaness init`',
    )
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

  it('reports a pinned package the project never declared', () => {
    const packageJson: Record<string, unknown> = {
      ...WIRED_PACKAGE_JSON,
      devDependencies: { ploaness: '1.0.0' },
    }
    const violations: readonly WiringViolation[] = findWiringViolations(
      wiredInputs({ packageJson }),
    )
    expect(
      violations.some((violation: WiringViolation) =>
        violation.reason.includes('the project must declare it'),
      ),
    ).toBe(true)
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

// ploaness ships the accessibility sweep as a managed spec, so the config that runs it is owned the same
// way the vitest config is: a project that rewrote it could drop `forbidOnly` and pass on one green test.
describe('the playwright config', () => {
  it('rejects a config that is not the bare re-export', () => {
    const playwrightConfig: string =
      "import { defineConfig } from '@playwright/test'\n\n" +
      'export default defineConfig({ forbidOnly: false })\n'
    const locations: readonly string[] = findWiringViolations(
      wiredInputs({ playwrightConfig }),
    ).map((violation: WiringViolation): string => violation.location)
    expect(locations).toContain('playwright.config.ts')
  })

  // Absent is a defect rather than an opt-out: the sweep is a managed file every project receives.
  it('reports the file as missing when it is absent', () => {
    const reasons: readonly string[] = findWiringViolations(
      wiredInputs({ playwrightConfig: undefined }),
    ).map((violation: WiringViolation): string => violation.reason)
    expect(reasons.some((reason: string): boolean => reason.includes('missing'))).toBe(true)
  })
})

// The standard pins the toolchain so an upstream release cannot change a verdict while the project
// stays unchanged. A range on an application dependency is that same hole one layer down.
const withDependency = (name: string, specifier: string): WiringInputs =>
  wiredInputs({
    packageJson: {
      ...WIRED_PACKAGE_JSON,
      devDependencies: { ploaness: '1.0.0', vitest: '4.1.11', [name]: specifier },
    },
  })

describe('a version range', () => {
  it('names the block a package is actually declared in', () => {
    const inputs: WiringInputs = wiredInputs({
      expectedTestLibraries: { next: '16.3.2' },
      packageJson: { ...WIRED_PACKAGE_JSON, dependencies: { next: '16.3.1' } },
    })
    expect(locations(inputs)).toContain('package.json dependencies.next')
  })

  it('rejects a caret range', () => {
    expect(locations(withDependency('graphql', '^16.14.2'))).toContain('package.json graphql')
  })

  it('rejects a tilde range', () => {
    expect(locations(withDependency('graphql', '~16.14.2'))).toContain('package.json graphql')
  })

  it('rejects a comparator', () => {
    expect(locations(withDependency('graphql', '>=16.0.0'))).toContain('package.json graphql')
  })

  it('rejects a wildcard, which is the widest range of all', () => {
    expect(locations(withDependency('graphql', '*'))).toContain('package.json graphql')
  })

  it('rejects a partial version, which floats on the digits it omits', () => {
    expect(locations(withDependency('graphql', '16.x'))).toContain('package.json graphql')
  })

  it('accepts an exact version', () => {
    expect(locations(withDependency('graphql', '16.14.2'))).not.toContain('package.json graphql')
  })

  // A pre-publication consumer resolves the ploaness packages from a local tarball, which is not a
  // range and must keep working.
  it('accepts a non-registry specifier, which names one artefact rather than a range', () => {
    const found: readonly string[] = locations(withDependency('ploaness', 'file:../x.tgz'))
    expect(found).not.toContain('package.json ploaness')
  })
})

// Payload fails at runtime when its own packages disagree, and the rule is derived from the pinned
// `payload` so a project that adds a plugin is covered without ploaness listing the plugin.
const withFamily = (version: string): WiringInputs =>
  wiredInputs({
    payloadVersion: '3.88.0',
    packageJson: {
      ...WIRED_PACKAGE_JSON,
      dependencies: { payload: '3.88.0', '@payloadcms/db-postgres': version },
    },
  })

describe('the Payload package family', () => {
  it('rejects a Payload package that disagrees with the pinned payload version', () => {
    expect(locations(withFamily('3.87.0'))).toContain('package.json @payloadcms/db-postgres')
  })

  it('accepts a Payload package that agrees, without being listed anywhere', () => {
    expect(locations(withFamily('3.88.0'))).not.toContain('package.json @payloadcms/db-postgres')
  })

  it('says nothing when ploaness pins no payload version', () => {
    const inputs: WiringInputs = wiredInputs({
      packageJson: {
        ...WIRED_PACKAGE_JSON,
        dependencies: { '@payloadcms/db-postgres': '3.87.0' },
      },
    })
    expect(locations(inputs)).not.toContain('package.json @payloadcms/db-postgres')
  })
})

// The package manager resolves the whole graph, so it decides what every other pin means. The engines
// block is what a project tells an installer and a CI image to use, which preflight cannot see.
describe('the declared toolchain', () => {
  it('rejects a package manager other than the pinned one', () => {
    const inputs: WiringInputs = wiredInputs({
      requiredPackageManager: 'pnpm@11.5.0',
      packageJson: { ...WIRED_PACKAGE_JSON, packageManager: 'pnpm@10.0.0' },
    })
    expect(locations(inputs)).toContain('package.json packageManager')
  })

  it('rejects a missing package manager, which pins nothing at all', () => {
    const inputs: WiringInputs = wiredInputs({ requiredPackageManager: 'pnpm@11.5.0' })
    expect(locations(inputs)).toContain('package.json packageManager')
  })

  it('accepts the pinned package manager', () => {
    const inputs: WiringInputs = wiredInputs({
      requiredPackageManager: 'pnpm@11.5.0',
      packageJson: { ...WIRED_PACKAGE_JSON, packageManager: 'pnpm@11.5.0' },
    })
    expect(locations(inputs)).not.toContain('package.json packageManager')
  })

  it('rejects an engines entry that states a runtime ploaness refuses', () => {
    const inputs: WiringInputs = wiredInputs({
      requiredEngines: { node: '>=26' },
      packageJson: { ...WIRED_PACKAGE_JSON, engines: { node: '>=20' } },
    })
    expect(locations(inputs)).toContain('package.json engines.node')
  })

  it('says nothing when ploaness requires no engines block', () => {
    expect(locations(wiredInputs())).not.toContain('package.json engines.node')
  })
})

// Changing the version is not the only way to change what a version installs.
const withKey = (holder: string, key: string, entry: string): WiringInputs =>
  wiredInputs({
    packageJson:
      holder === 'pnpm'
        ? { ...WIRED_PACKAGE_JSON, pnpm: { [key]: { [entry]: 'x' } } }
        : { ...WIRED_PACKAGE_JSON, [key]: { [entry]: 'x' } },
  })

describe('an escape from a pinned version', () => {
  it('rejects a package.json override of a pinned package', () => {
    expect(locations(withKey('root', 'overrides', 'vitest'))).toContain(
      'package.json overrides.vitest',
    )
  })

  it('rejects a yarn-style resolution of a pinned package', () => {
    expect(locations(withKey('root', 'resolutions', 'vitest'))).toContain(
      'package.json resolutions.vitest',
    )
  })

  // A patch keeps the version and swaps the code, which is the quietest bypass of the three.
  it('rejects a patch of a pinned package, keyed by name and version', () => {
    expect(locations(withKey('pnpm', 'patchedDependencies', 'vitest@4.1.11'))).toContain(
      'package.json patchedDependencies.vitest@4.1.11',
    )
  })

  it('rejects a package extension that rewrites a pinned package manifest', () => {
    expect(locations(withKey('pnpm', 'packageExtensions', 'vitest'))).toContain(
      'package.json packageExtensions.vitest',
    )
  })

  it('leaves an entry for a package ploaness does not pin alone', () => {
    expect(locations(withKey('pnpm', 'patchedDependencies', 'left-pad@1.3.0'))).toEqual([])
  })

  // A scoped name begins with the same character the version is split on.
  it('reads the package name out of a scoped patch key', () => {
    const inputs: WiringInputs = wiredInputs({
      expectedTestLibraries: { '@types/node': '26.2.0' },
      packageJson: {
        ...WIRED_PACKAGE_JSON,
        pnpm: { patchedDependencies: { '@types/node@26.2.0': 'x' } },
      },
    })
    expect(locations(inputs)).toContain('package.json patchedDependencies.@types/node@26.2.0')
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

  // The rule is not "no overrides": a transitive package with an unpatched advisory can be reached no
  // other way. It is "do not override what you declare", because the installed version would then
  // differ from the one every reader believes.
  it('rejects an override of a package the project declares itself', () => {
    const inputs: WiringInputs = wiredInputs({
      workspaceFile: ['overrides:', "  graphql: '17.0.0'"].join('\n'),
      packageJson: {
        ...WIRED_PACKAGE_JSON,
        dependencies: { graphql: '16.14.2' },
      },
    })
    expect(locations(inputs)).toContain('pnpm-workspace.yaml overrides.graphql')
  })

  it('leaves an override of a purely transitive package alone', () => {
    const inputs: WiringInputs = wiredInputs({
      workspaceFile: ['overrides:', "  dompurify: '^3.4.14'"].join('\n'),
    })
    expect(locations(inputs)).not.toContain('pnpm-workspace.yaml overrides.dompurify')
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

// The standard pins the toolchain to an exact version so an upstream release cannot change a verdict
// while the project stays unchanged. A caret range on a package a gate depends on is exactly that.
describe('the pinned toolchain', () => {
  it('rejects a declared version that differs from the pin', () => {
    const packageJson: Record<string, unknown> = {
      ...WIRED_PACKAGE_JSON,
      devDependencies: { ploaness: '1.0.0', vitest: '4.1.11', jsdom: '29.0.0' },
    }
    const reasons: readonly string[] = findWiringViolations(wiredInputs({ packageJson })).map(
      (violation: WiringViolation): string => violation.reason,
    )
    expect(reasons.some((reason: string) => reason.includes('ploaness pins it'))).toBe(true)
  })

  it('rejects a range where the pin is exact', () => {
    const packageJson: Record<string, unknown> = {
      ...WIRED_PACKAGE_JSON,
      devDependencies: { ploaness: '1.0.0', vitest: '4.1.11', jsdom: '^30.0.1' },
    }
    const locations: readonly string[] = findWiringViolations(wiredInputs({ packageJson })).map(
      (violation: WiringViolation): string => violation.location,
    )
    expect(locations).toContain('package.json devDependencies.jsdom')
  })

  // Forcing a declaration on a project that has no use for the package would manufacture a dependency
  // the dead-code gate then reports as unused.
  it('does not force a pinned package on a project that declares none', () => {
    const packageJson: Record<string, unknown> = {
      ...WIRED_PACKAGE_JSON,
      devDependencies: { ploaness: '1.0.0', vitest: '4.1.11' },
    }
    expect(findWiringViolations(wiredInputs({ packageJson }))).toEqual([])
  })

  it('still requires the packages every project imports', () => {
    const packageJson: Record<string, unknown> = {
      ...WIRED_PACKAGE_JSON,
      devDependencies: { ploaness: '1.0.0' },
    }
    const reasons: readonly string[] = findWiringViolations(wiredInputs({ packageJson })).map(
      (violation: WiringViolation): string => violation.reason,
    )
    expect(reasons.some((reason: string) => reason.includes('missing'))).toBe(true)
  })
})
