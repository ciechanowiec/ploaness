import { describe, expect, it } from 'vitest'
import {
  declaresInstallScriptAllowlist,
  findOverrides,
  findReleaseAgeViolations,
  findSilencedAdvisories,
  type OverrideEntry,
  packageNameOf,
} from '../src/install-policy.js'

const WORKSPACE: string = [
  'packages:',
  '  - packages/*',
  '',
  'overrides:',
  '  deepmerge-ts: "^8.0.2"',
  '  # a comment inside the block',
  "  vitest: '3.0.0'",
  '',
  'onlyBuiltDependencies:',
  '  - sharp',
  '',
].join('\n')

const namesOf = (entries: readonly OverrideEntry[]): readonly string[] =>
  entries.map((entry: OverrideEntry): string => entry.packageName)

describe('findOverrides', () => {
  it('reads every package an overrides block redefines', () => {
    expect(namesOf(findOverrides(WORKSPACE))).toEqual(['deepmerge-ts', 'vitest'])
  })

  it('ignores a comment inside the block', () => {
    expect(namesOf(findOverrides(WORKSPACE))).not.toContain('# a comment inside the block')
  })

  it('strips the quotes a project may put around a package name', () => {
    const quoted: string = ['overrides:', '  "@ploaness/cli": "1.0.0"'].join('\n')
    expect(namesOf(findOverrides(quoted))).toEqual(['@ploaness/cli'])
  })

  it('reads a yarn resolutions block by the same rule', () => {
    const resolutions: string = ['resolutions:', '  jsdom: "1.0.0"'].join('\n')
    expect(findOverrides(resolutions)[0]?.key).toBe('resolutions')
  })

  // The block ends at the next unindented line, so a later top-level key is not read as an override.
  it('stops at the end of the block', () => {
    expect(namesOf(findOverrides(WORKSPACE))).not.toContain('onlyBuiltDependencies')
  })

  it('finds nothing in a file that overrides nothing', () => {
    expect(findOverrides('packages:\n  - packages/*\n')).toEqual([])
  })

  it('finds nothing in an absent file', () => {
    expect(findOverrides('')).toEqual([])
  })
})

describe('declaresInstallScriptAllowlist', () => {
  it('accepts the key in the workspace file', () => {
    expect(declaresInstallScriptAllowlist(WORKSPACE, {})).toBe(true)
  })

  it('accepts the key under the pnpm key of package.json', () => {
    expect(declaresInstallScriptAllowlist('', { pnpm: { onlyBuiltDependencies: [] } })).toBe(true)
  })

  // An empty list is a decision: no dependency may run an install script. A missing key is not.
  it('accepts an empty allowlist, which permits nothing', () => {
    expect(declaresInstallScriptAllowlist('onlyBuiltDependencies: []\n', {})).toBe(true)
  })

  it('rejects a project that declares the key nowhere', () => {
    expect(declaresInstallScriptAllowlist('packages:\n  - packages/*\n', {})).toBe(false)
  })

  it('rejects a non-list value under the pnpm key', () => {
    expect(declaresInstallScriptAllowlist('', { pnpm: { onlyBuiltDependencies: 'sharp' } })).toBe(
      false,
    )
  })
})

describe('findSilencedAdvisories', () => {
  it('reports an ignored CVE list', () => {
    expect(findSilencedAdvisories({ pnpm: { auditConfig: { ignoreCves: ['CVE-1'] } } })).toEqual([
      'ignoreCves',
    ])
  })

  it('reports an ignored advisory list', () => {
    expect(findSilencedAdvisories({ pnpm: { auditConfig: { ignoreGhsas: ['GHSA-1'] } } })).toEqual([
      'ignoreGhsas',
    ])
  })

  it('reports both when both are present', () => {
    const config: unknown = { pnpm: { auditConfig: { ignoreCves: [], ignoreGhsas: [] } } }
    expect(findSilencedAdvisories(config)).toHaveLength(2)
  })

  it('finds nothing in a project that silences neither', () => {
    expect(findSilencedAdvisories({ pnpm: { onlyBuiltDependencies: [] } })).toEqual([])
  })

  it('finds nothing in a malformed manifest', () => {
    expect(findSilencedAdvisories('not an object')).toEqual([])
  })
})

describe('packageNameOf', () => {
  it('drops a version from an unscoped entry', () => {
    expect(packageNameOf('nx@21.6.5')).toBe('nx')
  })

  // A scoped name begins with the same character as a version separator, so the split has to be on
  // the last one.
  it('keeps the scope of a scoped entry', () => {
    expect(packageNameOf('@types/node@26.4.1')).toBe('@types/node')
  })

  it('returns a bare name unchanged', () => {
    expect(packageNameOf('@ploaness/cli')).toBe('@ploaness/cli')
  })
})

describe('findReleaseAgeViolations', () => {
  const Strict: string = 'minimumReleaseAgeStrict: true\n'

  it('requires the strict setting, so a too-young pin fails the install rather than being exempted', () => {
    expect(findReleaseAgeViolations('packages:\n  - packages/*\n')).toEqual([
      expect.stringContaining('minimumReleaseAgeStrict'),
    ])
  })

  it('rejects a strict setting that is anything but true', () => {
    expect(findReleaseAgeViolations('minimumReleaseAgeStrict: false\n')).toHaveLength(1)
  })

  it('reads the strict setting through quotes and a trailing comment', () => {
    expect(findReleaseAgeViolations("minimumReleaseAgeStrict: 'true' # refuse\n")).toEqual([])
  })

  it('reads the strict setting only at the top level', () => {
    expect(findReleaseAgeViolations('pnpm:\n  minimumReleaseAgeStrict: true\n')).toHaveLength(1)
  })

  it('permits every harness package, with or without a version', () => {
    const file: string = [
      Strict,
      'minimumReleaseAgeExclude:',
      "  - 'ploaness'",
      "  - '@ploaness/cli'",
      '  - ploaness@1.2.0',
      '  - "@ploaness/runtime@1.2.0"',
      '',
    ].join('\n')
    expect(findReleaseAgeViolations(file)).toEqual([])
  })

  // The exclusion list is the way around a held update, so the rule names what it found rather than
  // only that something was wrong.
  it('rejects an exclusion naming anything else, and names it', () => {
    const file: string = [
      Strict,
      'minimumReleaseAgeExclude:',
      "  - '@ploaness/config'",
      "  - '@types/react-dom@19.2.5'",
      '  - nx',
      '',
    ].join('\n')
    const findings: readonly string[] = findReleaseAgeViolations(file)
    expect(findings).toHaveLength(2)
    expect(findings[0]).toContain('@types/react-dom@19.2.5')
    expect(findings[1]).toContain('nx')
  })

  it('reports the strict setting before the exclusions', () => {
    const file: string = 'minimumReleaseAgeExclude:\n  - nx\n'
    expect(
      findReleaseAgeViolations(file).map((one: string): boolean => one.includes('Strict')),
    ).toEqual([true, false])
  })

  it('reports nothing for an empty file beyond the missing strict setting', () => {
    expect(findReleaseAgeViolations('')).toHaveLength(1)
  })
})
