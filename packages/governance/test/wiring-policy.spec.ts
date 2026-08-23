import { describe, expect, it } from 'vitest'
import { extractLiteralSourcePaths } from '../src/config-references.js'
import {
  findWiringViolations,
  REQUIRED_HOOKS,
  REQUIRED_SCRIPTS,
  REQUIRED_TSCONFIG_PATHS,
  requiredBiomeFiles,
} from '../src/wiring-policy.js'

const BIOME_FILES = requiredBiomeFiles(['src', 'tests', 'scripts'])

const WIRED_PACKAGE_JSON = {
  devDependencies: { ploaness: '1.0.0', vitest: '4.1.11' },
  scripts: { ...REQUIRED_SCRIPTS },
  'simple-git-hooks': { ...REQUIRED_HOOKS },
}

const wiredInputs = (overrides: Record<string, unknown> = {}) => ({
  packageJson: WIRED_PACKAGE_JSON,
  eslintConfig: "import ploaness from 'ploaness/eslint'\n\nexport default ploaness\n",
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
    const packageJson = {
      ...WIRED_PACKAGE_JSON,
      scripts: { ...REQUIRED_SCRIPTS, verify: 'echo ok' },
    }
    expect(locations(wiredInputs({ packageJson }))).toContain('package.json scripts.verify')
  })

  it('catches a missing verify:full script', () => {
    const scripts = { ...REQUIRED_SCRIPTS } as Record<string, string>
    delete scripts['verify:full']
    expect(locations(wiredInputs({ packageJson: { ...WIRED_PACKAGE_JSON, scripts } }))).toContain(
      'package.json scripts.verify:full',
    )
  })

  it('catches a removed git hook', () => {
    const hooks = { ...REQUIRED_HOOKS } as Record<string, string>
    delete hooks['pre-push']
    const packageJson = { ...WIRED_PACKAGE_JSON, 'simple-git-hooks': hooks }
    expect(locations(wiredInputs({ packageJson }))).toContain(
      'package.json simple-git-hooks.pre-push',
    )
  })
})

describe('config tampering', () => {
  it('catches rules appended after the harness ESLint config', () => {
    const eslintConfig = [
      "import ploaness from 'ploaness/eslint'",
      '',
      "export default [...ploaness, { rules: { 'no-explicit-any': 'off' } }]",
    ].join('\n')
    expect(locations(wiredInputs({ eslintConfig }))).toContain('eslint.config.mjs')
  })

  it('catches a Biome section the project redeclares', () => {
    const biomeConfig = JSON.stringify({
      extends: ['ploaness/biome'],
      files: BIOME_FILES,
      linter: { enabled: false },
    })
    expect(locations(wiredInputs({ biomeConfig }))).toContain('biome.json linter')
  })

  it('catches a compiler option the project overrides', () => {
    const tsconfig = JSON.stringify({
      extends: 'ploaness/tsconfig.json',
      compilerOptions: { strict: false },
      ...REQUIRED_TSCONFIG_PATHS,
    })
    expect(locations(wiredInputs({ tsconfig }))).toContain('tsconfig.json compilerOptions.strict')
  })

  it('allows paths, which a project legitimately owns', () => {
    const tsconfig = JSON.stringify({
      extends: 'ploaness/tsconfig.json',
      compilerOptions: { paths: { '@/*': ['./src/*'] } },
      ...REQUIRED_TSCONFIG_PATHS,
    })
    expect(findWiringViolations(wiredInputs({ tsconfig }))).toEqual([])
  })
})

describe('CI and dependencies', () => {
  it('catches extended verification missing from CI', () => {
    const workflows = [{ name: 'verify.yml', content: 'run: pnpm run lint' }]
    expect(locations(wiredInputs({ workflows }))).toContain('.github/workflows')
  })

  it('accepts CI invoking the owned script instead of the raw command', () => {
    const workflows = [{ name: 'verify.yml', content: 'run: pnpm run verify:full' }]
    expect(findWiringViolations(wiredInputs({ workflows }))).toEqual([])
  })

  it('catches a missing harness dependency', () => {
    const packageJson = { ...WIRED_PACKAGE_JSON, devDependencies: { vitest: '4.1.11' } }
    expect(locations(wiredInputs({ packageJson }))).toContain('package.json')
  })

  it('catches a test library pinned to the wrong version', () => {
    const packageJson = {
      ...WIRED_PACKAGE_JSON,
      devDependencies: { ploaness: '1.0.0', vitest: '3.0.0' },
    }
    expect(locations(wiredInputs({ packageJson }))).toContain('package.json devDependencies.vitest')
  })
})

describe('the Biome file-selection block', () => {
  it('catches a project that drops it, which would make Biome check the whole tree', () => {
    const biomeConfig = JSON.stringify({ extends: ['ploaness/biome'] })
    expect(locations(wiredInputs({ biomeConfig }))).toContain('biome.json files')
  })

  it('catches a project that widens it', () => {
    const biomeConfig = JSON.stringify({
      extends: ['ploaness/biome'],
      files: { ...BIOME_FILES, includes: ['src/**/*'] },
    })
    expect(locations(wiredInputs({ biomeConfig }))).toContain('biome.json files')
  })
})

describe('the tsconfig path keys', () => {
  it('catches a project that omits include, which would make tsc walk the harness package', () => {
    const tsconfig = JSON.stringify({
      extends: 'ploaness/tsconfig.json',
      exclude: ['node_modules'],
    })
    expect(locations(wiredInputs({ tsconfig }))).toContain('tsconfig.json include')
  })

  it('catches a project that narrows exclude', () => {
    const tsconfig = JSON.stringify({
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
