import { describe, expect, it } from 'vitest'
import {
  documentedEnvironmentNames,
  ENVIRONMENT_READ_EXEMPTIONS,
  type EnvironmentInputs,
  type EnvironmentViolation,
  findEnvironmentViolations,
  interpolatedEnvironmentNames,
  isVerifyingWorkflow,
  readEnvironmentNames,
  VALIDATED_ENVIRONMENT_MODULE,
  workflowSuppliedNames,
} from '../src/environment-coherence.js'

// The pure core takes file CONTENTS as plain strings, so a test writes the four kinds of file out and
// needs no fixture repository and no test double (see AGENTS.md "no mocks").

// A compose interpolation, ASSEMBLED rather than written out. Biome reads `${NAME}` inside a plain
// string as a template literal somebody forgot to write - which is exactly the shape a compose
// interpolation has - so writing one literally here would cost a suppression per fixture.
const interpolation = (body: string): string => `$\u{7B}${body}}`

const namesOf = (violations: readonly EnvironmentViolation[]): readonly string[] =>
  violations.map((violation: EnvironmentViolation): string => violation.name)

const EMPTY: EnvironmentInputs = {
  applicationSources: [],
  example: undefined,
  composeSources: [],
  workflows: [],
}

describe('readEnvironmentNames', () => {
  it('reads a bracketed access with either quote style', () => {
    const source: string = `
      const a = process.env['DATABASE_URL']
      const b = process.env["PAYLOAD_SECRET"]
    `
    expect(readEnvironmentNames(source)).toEqual(['DATABASE_URL', 'PAYLOAD_SECRET'])
  })

  // The distinction the module is built on. A variable this project invented can only be read with
  // brackets, because `process.env` is an index signature; a variable node declares is a known property
  // and is read with a dot. So a dotted read is ambient rather than project configuration, and no
  // example file owes a reader a line about it.
  it('ignores a dotted read, which can only name a variable the runtime declares', () => {
    expect(readEnvironmentNames('process.env.NODE_ENV !== "production"')).toEqual([])
  })

  it('reports each name once however often it is read', () => {
    const source: string = "process.env['SMTP_HOST'] ?? process.env['SMTP_HOST']"
    expect(readEnvironmentNames(source)).toEqual(['SMTP_HOST'])
  })

  it('tolerates whitespace inside the brackets', () => {
    expect(readEnvironmentNames("process.env[ 'SMTP_PORT' ]")).toEqual(['SMTP_PORT'])
  })

  it('finds nothing in a module that reads no environment at all', () => {
    expect(readEnvironmentNames('export const two = 1 + 1')).toEqual([])
  })
})

describe('documentedEnvironmentNames', () => {
  it('reads an assignment per line, in sorted order', () => {
    const example: string = ['SMTP_PORT=1025', 'DATABASE_URL=postgres://x'].join('\n')
    expect(documentedEnvironmentNames(example)).toEqual(['DATABASE_URL', 'SMTP_PORT'])
  })

  it('reads a name that is documented with no value', () => {
    expect(documentedEnvironmentNames('GOOGLE_AI_STUDIO_API_KEY=')).toEqual([
      'GOOGLE_AI_STUDIO_API_KEY',
    ])
  })

  it('accepts the exported form', () => {
    expect(documentedEnvironmentNames('export SMTP_HOST=127.0.0.1')).toEqual(['SMTP_HOST'])
  })

  it('ignores a comment, including one that quotes an assignment', () => {
    const example: string = ['# SMTP_HOST=127.0.0.1 is the default', 'SMTP_PORT=1025'].join('\n')
    expect(documentedEnvironmentNames(example)).toEqual(['SMTP_PORT'])
  })
})

describe('interpolatedEnvironmentNames', () => {
  it('reads a braced interpolation', () => {
    expect(interpolatedEnvironmentNames(`published: ${interpolation('SMTP_PORT')}`)).toEqual([
      'SMTP_PORT',
    ])
  })

  // A default supplies the value, so the name is resolvable with nothing declared anywhere and this
  // gate has no claim on it. The same goes for the error form, which states its own failure.
  it('ignores an interpolation that carries its own default', () => {
    const compose: string = [
      interpolation('POSTGRES_PORT:-5432'),
      interpolation('A-x'),
      interpolation('B:?must be set'),
    ].join(' ')
    expect(interpolatedEnvironmentNames(compose)).toEqual([])
  })

  it('ignores an escaped dollar, which compose reads as a literal', () => {
    expect(interpolatedEnvironmentNames('test: ["CMD", "echo $$HOME"]')).toEqual([])
  })

  it('reports each name once however often it is interpolated', () => {
    const twice: string = `${interpolation('SMTP_PORT')} ${interpolation('SMTP_PORT')}`
    expect(interpolatedEnvironmentNames(twice)).toEqual(['SMTP_PORT'])
  })
})

describe('workflowSuppliedNames', () => {
  it('reads a mapping key at any nesting depth', () => {
    const workflow: string = [
      '    env:',
      '      SMTP_PORT: "1025"',
      '      SMTP_HOST: 127.0.0.1',
    ].join('\n')
    expect(workflowSuppliedNames(workflow)).toEqual(['SMTP_HOST', 'SMTP_PORT'])
  })

  it('reads a name supplied from the secrets, vars, or env context', () => {
    const workflow: string = [
      `token: ${interpolation('{ secrets.NPM_TOKEN }')}`,
      `region: ${interpolation('{ vars.AWS_REGION }')}`,
    ].join(' ')
    expect(workflowSuppliedNames(workflow)).toEqual(['AWS_REGION', 'NPM_TOKEN'])
  })

  // Lowercase keys are the workflow's own vocabulary - `jobs`, `steps`, `runs-on` - rather than
  // environment variables, and reading them as supplied names would let any workflow vouch for
  // anything.
  it('ignores the workflow own lowercase keys', () => {
    const workflow: string = ['jobs:', '  verify:', '    runs-on: ubuntu-latest'].join('\n')
    expect(workflowSuppliedNames(workflow)).toEqual([])
  })
})

describe('isVerifyingWorkflow', () => {
  it('recognises a full verification', () => {
    expect(isVerifyingWorkflow('run: pnpm run verify:full')).toBe(true)
  })

  it('recognises a single gate', () => {
    expect(isVerifyingWorkflow('run: pnpm exec ploaness gate docker')).toBe(true)
  })

  // A workflow that evaluates no compose file is owed no compose variable, which is what keeps this
  // rule from reporting a repository whose CI publishes a release.
  it('does not recognise a workflow that only publishes', () => {
    expect(isVerifyingWorkflow('run: pnpm publish --access public')).toBe(false)
  })
})

describe('findEnvironmentViolations', () => {
  it('passes over an empty set when the repository declares nothing', () => {
    expect(findEnvironmentViolations(EMPTY)).toEqual([])
  })

  it('reports a variable the application reads and no example file documents', () => {
    const violations: readonly EnvironmentViolation[] = findEnvironmentViolations({
      ...EMPTY,
      applicationSources: ["process.env['SMTP_HOST']"],
      example: 'DATABASE_URL=postgres://x',
    })
    expect(namesOf(violations)).toEqual(['SMTP_HOST'])
    expect(violations[0]?.origin).toBe('application')
  })

  it('reports a variable the application reads when the repository ships no example file at all', () => {
    const violations: readonly EnvironmentViolation[] = findEnvironmentViolations({
      ...EMPTY,
      applicationSources: ["process.env['SMTP_HOST']"],
    })
    expect(namesOf(violations)).toEqual(['SMTP_HOST'])
  })

  it('reports a variable a compose file interpolates and no example file documents', () => {
    const violations: readonly EnvironmentViolation[] = findEnvironmentViolations({
      ...EMPTY,
      composeSources: [`published: ${interpolation('MAILPIT_WEB_PORT')}`],
      example: 'DATABASE_URL=postgres://x',
    })
    expect(namesOf(violations)).toEqual(['MAILPIT_WEB_PORT'])
    expect(violations[0]?.origin).toBe('compose')
  })
})

// Split from the block above only because a describe callback is capped at fifty lines; this half is
// the workflow rule and the one-directional discipline that keeps it honest.
describe('findEnvironmentViolations, and what a workflow owes', () => {
  // The failure that is invisible locally: a developer's `.env` resolves the interpolation, and CI,
  // which has no such file, fails inside `docker compose config` several steps from the omission.
  it('reports a compose variable a verifying workflow does not supply', () => {
    const violations: readonly EnvironmentViolation[] = findEnvironmentViolations({
      ...EMPTY,
      composeSources: [`published: ${interpolation('SMTP_PORT')}`],
      example: 'SMTP_PORT=1025',
      workflows: [{ file: '.github/workflows/verify.yml', content: 'run: pnpm run verify:full' }],
    })
    expect(namesOf(violations)).toEqual(['SMTP_PORT'])
    expect(violations[0]?.reason).toContain('.github/workflows/verify.yml')
  })

  it('accepts a compose variable the verifying workflow exports', () => {
    const workflow: string = ['run: pnpm run verify:full', 'env:', '  SMTP_PORT: "1025"'].join('\n')
    expect(
      findEnvironmentViolations({
        ...EMPTY,
        composeSources: [`published: ${interpolation('SMTP_PORT')}`],
        example: 'SMTP_PORT=1025',
        workflows: [{ file: '.github/workflows/verify.yml', content: workflow }],
      }),
    ).toEqual([])
  })

  it('asks nothing of a workflow that runs no verification', () => {
    expect(
      findEnvironmentViolations({
        ...EMPTY,
        composeSources: [`published: ${interpolation('SMTP_PORT')}`],
        example: 'SMTP_PORT=1025',
        workflows: [{ file: '.github/workflows/release.yml', content: 'run: pnpm publish' }],
      }),
    ).toEqual([])
  })
})

// The third split, for the same fifty-line cap: what the gate deliberately does NOT report.
describe('findEnvironmentViolations, and what it deliberately allows', () => {
  // The one-directional rule, which is what keeps the gate free of false positives: an example file
  // documents an optional key no code path requires, and that is documentation rather than rot.
  it('does not report a documented variable nothing reads', () => {
    expect(
      findEnvironmentViolations({
        ...EMPTY,
        applicationSources: ["process.env['DATABASE_URL']"],
        example: ['DATABASE_URL=postgres://x', 'GOOGLE_AI_STUDIO_API_KEY='].join('\n'),
      }),
    ).toEqual([])
  })

  it('reads every member module, so a workspace cannot hide one', () => {
    const violations: readonly EnvironmentViolation[] = findEnvironmentViolations({
      ...EMPTY,
      applicationSources: ["process.env['A_URL']", "process.env['B_URL']"],
      example: 'A_URL=x',
    })
    expect(namesOf(violations)).toEqual(['B_URL'])
  })

  it('reports one variable per workflow that is missing it', () => {
    const violations: readonly EnvironmentViolation[] = findEnvironmentViolations({
      ...EMPTY,
      composeSources: [`published: ${interpolation('SMTP_PORT')}`],
      example: 'SMTP_PORT=1025',
      workflows: [
        { file: 'a.yml', content: 'run: pnpm run verify' },
        { file: 'b.yml', content: 'run: ploaness verify' },
      ],
    })
    expect(violations).toHaveLength(2)
  })
})

describe('the declared module paths', () => {
  // One list, two consumers: the ESLint rule that bans `process.env` elsewhere and the gate that reads
  // the variables out of the module the rule exempts. Written twice, one of them would drift and the
  // gate would read a file no rule protects.
  it('exempts the validated module from the process.env ban', () => {
    expect(ENVIRONMENT_READ_EXEMPTIONS).toContain(VALIDATED_ENVIRONMENT_MODULE)
  })

  // Exempt from the LINT rule and deliberately not read by the gate: what it reads there is `NODE_ENV`,
  // which the framework sets and no example file should claim to document.
  it('also exempts the edge proxy, which the gate does not read', () => {
    expect(ENVIRONMENT_READ_EXEMPTIONS).toContain('src/proxy.ts')
    expect(VALIDATED_ENVIRONMENT_MODULE).not.toBe('src/proxy.ts')
  })
})
