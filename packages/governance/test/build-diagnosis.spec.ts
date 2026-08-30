import { describe, expect, it } from 'vitest'
import { diagnoseBuildFailure } from '../src/build-diagnosis.js'

// The message a real consumer's build died with, quoted from its own output.
const MISSING_RELATION: string = [
  '  Error: relation "venue_settings" does not exist',
  '  at async Object.readVenueSettings',
].join('\n')

describe('diagnoseBuildFailure', () => {
  it('explains a missing relation as a prerender against the empty build database', () => {
    const hint: readonly string[] = diagnoseBuildFailure(MISSING_RELATION)
    expect(hint[0]).toContain('prerendered against the empty build database')
    expect(hint.join('\n')).toContain('connection()')
  })

  it('names the current spelling and why the older one still appears to work', () => {
    expect(diagnoseBuildFailure(MISSING_RELATION).join('\n')).toContain('force-dynamic')
  })

  it('recognises the quoted and unquoted forms and a schema-qualified name', () => {
    expect(diagnoseBuildFailure('relation venue_settings does not exist')).not.toEqual([])
    expect(diagnoseBuildFailure('relation "public.posts" does not exist')).not.toEqual([])
  })

  it('says nothing about a build failure it does not recognise', () => {
    expect(diagnoseBuildFailure('Type error: Property x does not exist on type Y')).toEqual([])
    expect(diagnoseBuildFailure('')).toEqual([])
  })
})
