// The joint between the rule and the scaffolder that writes the file the rule judges.
//
// `REQUIRED_BIOME_EXTENDS`, `REQUIRED_TSCONFIG_EXTENDS`, `REQUIRED_SCRIPTS` and the rest exist for one
// reason, stated in AGENTS.md: two literals that must stay equal will not stay equal, and that has
// already shipped a defect where `init` scaffolded a project which then failed the gate. They were the
// answer to that - and no test asserted the joint they were created to hold.
//
// So these do not check a constant against its own value. They build what the scaffolder writes, from
// the same constants, and feed it to the rule.
import { describe, expect, it } from 'vitest'
import {
  findWiringViolations,
  REQUIRED_BIOME_EXTENDS,
  REQUIRED_SCRIPTS,
  REQUIRED_TSCONFIG_EXTENDS,
  REQUIRED_TSCONFIG_PATHS,
  requiredBiomeFiles,
  type WiringInputs,
} from '../src/index.js'
import type { WiringViolation } from '../src/wiring-violation.js'

const JSON_INDENT: number = 2
const SOURCE_ROOTS: readonly string[] = ['src', 'tests']

// Byte for byte what `packages/cli/src/commands/init.ts` writes. If that scaffolder changes shape, this
// stops describing it - which is the drift worth catching, and why the bodies are built from the same
// exported constants rather than pasted.
const biomeStub = (): string =>
  `${JSON.stringify(
    { extends: [REQUIRED_BIOME_EXTENDS], files: requiredBiomeFiles(SOURCE_ROOTS) },
    null,
    JSON_INDENT,
  )}\n`

const tsconfigStub = (): string =>
  `${JSON.stringify(
    {
      extends: REQUIRED_TSCONFIG_EXTENDS,
      compilerOptions: {
        paths: { '@/*': ['./src/*'], '@payload-config': ['./src/payload.config.ts'] },
      },
      ...REQUIRED_TSCONFIG_PATHS,
    },
    null,
    JSON_INDENT,
  )}\n`

const reexport = (specifier: string): string =>
  `import ploaness from '${specifier}'\n\nexport default ploaness\n`

const scaffolded = (): WiringInputs => ({
  packageJson: {
    dependencies: { ploaness: '1.0.0' },
    scripts: { ...REQUIRED_SCRIPTS },
  },
  eslintConfig: reexport('ploaness/eslint'),
  vitestConfig: reexport('ploaness/vitest'),
  playwrightConfig: reexport('ploaness/playwright'),
  workspaceFile: '',
  declaredExclusions: [],
  biomeConfig: biomeStub(),
  tsconfig: tsconfigStub(),
  expectedTestLibraries: {},
  requiredTestLibraries: new Set<string>(),
  payloadVersion: undefined,
  requiredPackageManager: undefined,
  requiredEngines: {},
  requiredBiomeFiles: requiredBiomeFiles(SOURCE_ROOTS),
})

describe('what init scaffolds is what wiring requires', () => {
  it('reports nothing about a project the scaffolder just wrote', () => {
    expect(findWiringViolations(scaffolded())).toEqual([])
  })

  it.each([
    ['biome.json', 'biomeConfig'],
    ['tsconfig.json', 'tsconfig'],
    ['eslint.config.mjs', 'eslintConfig'],
    ['vitest.config.mts', 'vitestConfig'],
    ['playwright.config.ts', 'playwrightConfig'],
  ])('reports %s when the scaffolder never wrote it', (file: string, key: string) => {
    const violations: readonly WiringViolation[] = findWiringViolations({
      ...scaffolded(),
      [key]: undefined,
    })
    expect(
      violations.map((violation: WiringViolation): string => violation.location).join(' '),
    ).toContain(file)
  })

  // The specifiers are the values the two sides have to agree about, so a change to either that is not
  // a change to both shows up here rather than in a consumer's first run.
  it('requires the biome specifier the scaffolder writes', () => {
    const biomeConfig: string = biomeStub().replace(REQUIRED_BIOME_EXTENDS, 'somewhere/else')
    expect(findWiringViolations({ ...scaffolded(), biomeConfig })).not.toEqual([])
  })

  it('requires the tsconfig specifier the scaffolder writes', () => {
    const tsconfig: string = tsconfigStub().replace(REQUIRED_TSCONFIG_EXTENDS, 'ploaness/tsconfig')
    expect(findWiringViolations({ ...scaffolded(), tsconfig })).not.toEqual([])
  })

  it.each(Object.keys(REQUIRED_SCRIPTS))(
    'requires the %s script the scaffolder writes',
    (name: string) => {
      const scripts: Record<string, string> = { ...REQUIRED_SCRIPTS, [name]: 'echo ok' }
      const packageJson: Record<string, unknown> = { dependencies: { ploaness: '1.0.0' }, scripts }
      const violations: readonly WiringViolation[] = findWiringViolations({
        ...scaffolded(),
        packageJson,
      })
      expect(
        violations.map((violation: WiringViolation): string => violation.location).join(' '),
      ).toContain(name)
    },
  )
})
