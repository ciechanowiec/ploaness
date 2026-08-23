import { describe, expect, it } from 'vitest'
import { findSkillManifestViolations, type SkillViolation } from '../src/skill-manifest.js'

// The pure core takes the file text and directory name as plain values, so a test feeds real strings
// with no test double (see AGENTS.md "no mocks").
const frontmatter = (body: string): string => `---\n${body}\n---\n\n# Heading\n\nProse.\n`

const run = (content: string, directoryName = 'payload'): readonly SkillViolation[] =>
  findSkillManifestViolations({ content, directoryName })

const valid = frontmatter(
  'name: payload\ndescription: Use this skill when working with Payload CMS projects.',
)

describe('findSkillManifestViolations - frontmatter presence', () => {
  it('accepts a SKILL.md with a sound frontmatter contract', () => {
    expect(run(valid)).toEqual([])
  })

  it('flags a file that does not open with frontmatter', () => {
    const violations = run('# Just a heading\n\nNo frontmatter here.\n')
    expect(violations).toEqual([
      { rule: 'frontmatter', reason: 'file must open with valid "---" frontmatter' },
    ])
  })
})

describe('findSkillManifestViolations - name', () => {
  it('flags a missing name key', () => {
    const violations = run(frontmatter('description: Use when working on things.'))
    expect(violations).toContainEqual({ rule: 'name', reason: 'frontmatter has no "name" key' })
  })

  it('flags a non-kebab-case name', () => {
    const violations = run(
      frontmatter('name: Payload_Skill\ndescription: Use when editing.'),
      'Payload_Skill',
    )
    expect(violations).toContainEqual({
      rule: 'name',
      reason: 'name "Payload_Skill" must be kebab-case',
    })
  })

  it('flags a name that does not match its parent directory', () => {
    const violations = run(
      frontmatter('name: payload\ndescription: Use when editing.'),
      'payload-cms',
    )
    expect(violations).toContainEqual({
      rule: 'name',
      reason: 'name "payload" must equal parent directory "payload-cms"',
    })
  })
})

describe('findSkillManifestViolations - description', () => {
  it('flags a missing description key', () => {
    const violations = run(frontmatter('name: payload'))
    expect(violations).toContainEqual({
      rule: 'description',
      reason: 'frontmatter has no "description" key',
    })
  })

  it('flags an empty description value', () => {
    const violations = run(frontmatter('name: payload\ndescription:'))
    expect(violations).toContainEqual({
      rule: 'description',
      reason: 'frontmatter has no "description" key',
    })
  })

  it('flags a description with no when-to-use clause', () => {
    const violations = run(frontmatter('name: payload\ndescription: Helps with Payload stuff.'))
    expect(violations).toContainEqual({
      rule: 'description',
      reason: 'description must say when to use the skill ("when ..." clause)',
    })
  })
})

describe('findSkillManifestViolations - keys', () => {
  it('accepts the recognised optional keys', () => {
    const content = frontmatter(
      'name: payload\ndescription: Use when editing.\nlicense: MIT\nallowed-tools: Read',
    )
    expect(run(content)).toEqual([])
  })

  it('ignores keys nested under a top-level key such as metadata', () => {
    const content = frontmatter(
      'name: payload\ndescription: Use when editing.\nmetadata:\n  type: reference',
    )
    expect(run(content)).toEqual([])
  })

  it('flags an unknown top-level frontmatter key', () => {
    const content = frontmatter('name: payload\ndescription: Use when editing.\nauthor: someone')
    expect(run(content)).toContainEqual({
      rule: 'keys',
      reason: 'unknown frontmatter key "author"',
    })
  })
})
