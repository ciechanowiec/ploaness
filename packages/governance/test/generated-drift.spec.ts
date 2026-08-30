import { describe, expect, it } from 'vitest'
import { findGeneratedDrift, type RegeneratedArtefact } from '../src/generated-drift.js'

const TYPES: string = 'src/payload-types.ts'

const artefact = (overrides: Partial<RegeneratedArtefact> = {}): RegeneratedArtefact => ({
  target: TYPES,
  isTracked: true,
  before: 'export interface Booking {}\n',
  after: 'export interface Booking {}\n',
  ...overrides,
})

describe('findGeneratedDrift', () => {
  it('passes an artefact the generator rewrote identically', () => {
    expect(findGeneratedDrift([artefact()])).toEqual([])
  })

  it('reports an artefact the generator changed', () => {
    const stale: RegeneratedArtefact = artefact({ before: 'export interface Booking {\n' })

    expect(findGeneratedDrift([stale])).toEqual([`${TYPES} changed when regenerated`])
  })

  // The whole point of comparing content rather than asking git. A developer who regenerates as part of
  // the change they are making has an artefact that matches its configuration exactly, and whether they
  // have staged it is a fact about their index, not about the configuration. The old comparison read
  // the unstaged file as drift and told them to commit what they had already brought up to date.
  it('says nothing about whether the change has been staged or committed', () => {
    const uncommitted: RegeneratedArtefact = artefact({ before: undefined, after: 'generated\n' })
    const settled: RegeneratedArtefact = artefact({ before: 'generated\n', after: 'generated\n' })

    expect(findGeneratedDrift([uncommitted])).toEqual([`${TYPES} changed when regenerated`])
    expect(findGeneratedDrift([settled])).toEqual([])
  })

  it('reports an artefact git does not track, even when it did not change', () => {
    const untracked: RegeneratedArtefact = artefact({ isTracked: false })

    expect(findGeneratedDrift([untracked])).toEqual([
      `${TYPES} is not tracked by git, so no committed version exists to compare against`,
    ])
  })

  // Being untracked is the worse fault, not a milder form of drift, so it is the one reported: a file
  // regenerating from a configuration nobody can review is a gap in the review, and telling the reader
  // it also drifted would bury that under the smaller finding.
  it('reports only the untracked fault when the artefact both drifted and is untracked', () => {
    const both: RegeneratedArtefact = artefact({ isTracked: false, before: 'stale\n' })

    expect(findGeneratedDrift([both])).toHaveLength(1)
  })

  // A project with no admin panel has no import map. Demanding one would be a rule about the shape of
  // the project rather than about its generated output.
  it('ignores an artefact the configuration does not produce at all', () => {
    const absent: RegeneratedArtefact = artefact({
      isTracked: false,
      before: undefined,
      after: undefined,
    })

    expect(findGeneratedDrift([absent])).toEqual([])
  })

  it('reports every drifting artefact, in the order it was given them', () => {
    const map: RegeneratedArtefact = artefact({
      target: 'importMap.js',
      before: 'old\n',
      after: 'new\n',
    })
    const types: RegeneratedArtefact = artefact({ before: 'old\n', after: 'new\n' })

    expect(findGeneratedDrift([map, types])).toEqual([
      'importMap.js changed when regenerated',
      `${TYPES} changed when regenerated`,
    ])
  })

  it('answers nothing for a project with no generated artefacts', () => {
    expect(findGeneratedDrift([])).toEqual([])
  })
})
