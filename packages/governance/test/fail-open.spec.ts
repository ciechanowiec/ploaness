// The cases where a rule reported nothing because it had judged nothing.
//
// A false pass is the worst defect a gate can carry: it is indistinguishable from a real one, and
// nothing downstream ever contradicts it. Each case below is one the shipped rules produced.
import { describe, expect, it } from 'vitest'
import { findOverrides, type OverrideEntry } from '../src/install-policy.js'
import { parseJsonc } from '../src/json-shapes.js'
import { type Advisory, judgeVulnerabilities } from '../src/vulnerability-policy.js'
import { findWiringViolations, type WiringInputs } from '../src/wiring-policy.js'

const namesIn = (body: string): readonly string[] =>
  findOverrides(['overrides:', ...body.split('\n')].join('\n')).map(
    (entry: OverrideEntry): string => entry.packageName,
  )

// A YAML value carries colons of its own. Splitting the line at the LAST one read `react: npm:preact`
// as a package called "react: npm", which matched nothing in the pinned set - so every alias form,
// which is exactly how one package is swapped for another, walked through the anti-bypass rule.
describe('an override whose value contains a colon', () => {
  it('reads an npm alias as the package it overrides', () => {
    expect(namesIn('  react: npm:preact@10.0.0')).toEqual(['react'])
  })

  it('reads a link specifier as the package it overrides', () => {
    expect(namesIn('  payload: link:../local-payload')).toEqual(['payload'])
  })

  it('reads a git specifier as the package it overrides', () => {
    expect(namesIn('  left-pad: git+ssh://git@example.invalid/left-pad.git')).toEqual(['left-pad'])
  })

  it('reads a plain version as before', () => {
    expect(namesIn('  lodash: 4.17.21')).toEqual(['lodash'])
  })

  it('reads a quoted scoped name, whose own key carries no colon', () => {
    expect(namesIn('  "@scope/pkg": "file:../pkg.tgz"')).toEqual(['@scope/pkg'])
  })

  it('carries the specifier through, so a rule can tell a version from an artefact', () => {
    const entries: readonly OverrideEntry[] = findOverrides(
      ['overrides:', '  react: npm:preact@10.0.0'].join('\n'),
    )
    expect(entries[0]?.specifier).toBe('npm:preact@10.0.0')
  })
})

const advisory = (severity: string): Advisory => ({
  id: 'GHSA-xxxx',
  packageName: 'left-pad',
  severity,
  title: 'a title',
  aliases: [],
})

const reported = (severity: string): number =>
  judgeVulnerabilities([advisory(severity)], [], 'moderate').unsuppressed.length

// The advisory gate is fail-closed by design; the severity read was not. An advisory whose severity was
// absent, misspelled, or newly introduced upstream ranked at -1 and was dropped from the report.
describe('an advisory whose severity this scale does not know', () => {
  it.each(['', 'unknown', 'SEVERE', 'hgih'])(
    'reports the advisory rather than dropping it (%j)',
    (severity: string) => {
      expect(reported(severity)).toBe(1)
    },
  )

  it('still reports a known severity at the threshold', () => {
    expect(reported('critical')).toBe(1)
  })

  it('still says nothing about a known severity below the threshold', () => {
    expect(reported('low')).toBe(0)
  })

  it('reads a known severity whatever its casing', () => {
    expect(reported('CRITICAL')).toBe(1)
  })
})

// A tsconfig legally carries comments, and `create-payload-app` writes one that does. The rule parsed
// it with `JSON.parse`, so the SyntaxError escaped a pure function into a precondition gate, and the
// whole run halted saying only that the gate "could not run".
describe('a JSON document that carries comments', () => {
  it('reads a line comment', () => {
    expect(parseJsonc('{\n // why\n "a": 1\n}').value).toEqual({ a: 1 })
  })

  it('reads a block comment', () => {
    expect(parseJsonc('{\n /* why */\n "a": 1\n}').value).toEqual({ a: 1 })
  })

  it('reads a trailing comma', () => {
    expect(parseJsonc('{ "a": 1, }').value).toEqual({ a: 1 })
  })

  // The hard part is not finding the slashes but knowing when they are inside a string.
  it('leaves a comment marker inside a string alone', () => {
    expect(parseJsonc('{ "a": "https://example.invalid" }').value).toEqual({
      a: 'https://example.invalid',
    })
  })

  it('leaves a comma inside a string alone', () => {
    expect(parseJsonc('{ "a": "one, two" }').value).toEqual({ a: 'one, two' })
  })

  it('reports the reason a genuinely malformed document could not be read', () => {
    expect(parseJsonc('{ "a": }').problem).toBeDefined()
  })

  it('reports no problem for a document it could read', () => {
    expect(parseJsonc('{}').problem).toBeUndefined()
  })
})

const wiringInputs = (overrides: Partial<WiringInputs> = {}): WiringInputs => ({
  packageJson: {},
  eslintConfig: undefined,
  vitestConfig: undefined,
  playwrightConfig: undefined,
  workspaceFile: '',
  declaredExclusions: [],
  biomeConfig: undefined,
  tsconfig: undefined,
  expectedTestLibraries: {},
  requiredTestLibraries: new Set<string>(),
  payloadVersion: undefined,
  requiredPackageManager: undefined,
  requiredEngines: {},
  requiredBiomeFiles: {},
  ...overrides,
})

const reasonsFor = (overrides: Partial<WiringInputs>): readonly string[] =>
  findWiringViolations(wiringInputs(overrides)).map((violation) => violation.reason)

describe('a config file the wiring rule reads as JSON', () => {
  it('does not throw on a tsconfig carrying comments', () => {
    const tsconfig: string = '{\n  // the ploaness base\n  "extends": "ploaness/tsconfig.json"\n}'
    expect(() => findWiringViolations(wiringInputs({ tsconfig }))).not.toThrow()
  })

  it('reads the extends through the comments rather than reporting it missing', () => {
    const tsconfig: string = '{\n  // the ploaness base\n  "extends": "ploaness/tsconfig.json"\n}'
    expect(reasonsFor({ tsconfig }).join(' ')).not.toContain('must declare "extends"')
  })

  it('reports genuinely malformed JSON as a finding rather than as a crash', () => {
    expect(reasonsFor({ tsconfig: '{ "extends": }' }).join(' ')).toContain('not valid JSON')
  })

  it('reports a malformed biome config the same way', () => {
    expect(reasonsFor({ biomeConfig: '{ "extends": }' }).join(' ')).toContain('not valid JSON')
  })
})

// `.` does not cross a `\r`, so on a CRLF checkout every comment line survived the filter and the
// re-export check failed on a file that was correct.
describe('a re-export config the harness owns', () => {
  const Eslint: string = "import ploaness from 'ploaness/eslint'\nexport default ploaness\n"

  it('accepts the bare re-export', () => {
    expect(reasonsFor({ eslintConfig: Eslint }).join(' ')).not.toContain('eslint.config.mjs')
  })

  it('accepts it with CRLF line endings', () => {
    expect(reasonsFor({ eslintConfig: Eslint.replaceAll('\n', '\r\n') }).join(' ')).not.toContain(
      'eslint.config.mjs',
    )
  })

  it('accepts a line-comment preamble', () => {
    expect(reasonsFor({ eslintConfig: `// generated\n${Eslint}` }).join(' ')).not.toContain(
      'eslint.config.mjs',
    )
  })

  it('accepts a block-comment preamble, which a generator writes', () => {
    expect(
      reasonsFor({ eslintConfig: `/* generated\n   by a tool */\n${Eslint}` }).join(' '),
    ).not.toContain('eslint.config.mjs')
  })

  it('still reports a local block appended after the re-export', () => {
    const withBlock: string = `${Eslint}export const extra = [{ rules: {} }]\n`
    expect(reasonsFor({ eslintConfig: withBlock }).join(' ')).toContain('nothing but')
  })
})
