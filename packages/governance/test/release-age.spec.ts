import { describe, expect, it } from 'vitest'
import { hoursPublished, isHeldByReleaseAge, RELEASE_AGE_FLOOR_HOURS } from '../src/release-age.js'

const HOUR: number = 3_600_000
const NOW: number = Date.parse('2026-08-26T05:00:00.000Z')

// Ages are expressed as hours before NOW so a case reads as the wait it describes, rather than as two
// epoch numbers a reader has to subtract.
const isHeldAt = (hoursAgo: number): boolean =>
  isHeldByReleaseAge({ publishedAt: NOW - hoursAgo * HOUR, now: NOW })

describe('isHeldByReleaseAge', () => {
  it('holds a release published minutes ago', () => {
    expect(isHeldAt(0.5)).toBe(true)
  })

  // The boundary both ways, because this is the whole of the rule: the observed refusals sat just
  // under a day and the acceptance just over it.
  it('holds a release that is still short of the floor by minutes', () => {
    expect(isHeldAt(RELEASE_AGE_FLOOR_HOURS - 0.05)).toBe(true)
  })

  it('releases one that has reached the floor exactly', () => {
    expect(isHeldAt(RELEASE_AGE_FLOOR_HOURS)).toBe(false)
  })

  it('releases one older than the floor', () => {
    expect(isHeldAt(RELEASE_AGE_FLOOR_HOURS * 7)).toBe(false)
  })

  // An unknown date must never hold: the report would then hide an update the project can take, and
  // the registry not answering is not evidence about the release.
  it('never holds a release whose publication date the registry did not give', () => {
    expect(isHeldByReleaseAge({ publishedAt: undefined, now: NOW })).toBe(false)
  })
})

describe('hoursPublished', () => {
  it('floors to whole hours, so a report never rounds a wait away', () => {
    expect(hoursPublished({ publishedAt: NOW - (HOUR * 13 + HOUR / 2), now: NOW })).toBe(13)
  })

  it('reports nothing when the publication instant is unknown', () => {
    expect(hoursPublished({ publishedAt: undefined, now: NOW })).toBeUndefined()
  })
})
