import { describe, expect, it } from 'vitest'
import type { CheckovCheck, CuratedProviderName } from '../src/checkov-check.js'
import {
  CHECKOV_CHECKS,
  checkovCheckList,
  checksFor,
  classifyProviders,
  curatedProviders,
  failedCheckCount,
  PROVIDERS_WITHOUT_CHECKS,
  type ProviderClassification,
} from '../src/checkov-policy.js'

// The token checkov puts in an id for each provider. A check filed under the wrong cloud would be sent
// to the analyzer all the same, but counted against the wrong provider in the summary.
const FAMILY_OF: Readonly<Record<CuratedProviderName, string>> = { aws: 'AWS' }

describe('CHECKOV_CHECKS', () => {
  // An empty catalogue would render an empty `--check`, and checkov reads that as every check rather
  // than none. The one assertion here that guards against a verdict nobody chose.
  it('enables at least one check', () => {
    expect(CHECKOV_CHECKS.length).toBeGreaterThan(0)
  })

  it('names every check by an identifier of the cloud it is filed under', () => {
    const misfiled: readonly CheckovCheck[] = CHECKOV_CHECKS.filter(
      (check: CheckovCheck): boolean =>
        !new RegExp(String.raw`^CKV2?_${FAMILY_OF[check.provider]}_\d+$`).test(check.id),
    )
    expect(misfiled).toEqual([])
  })

  // A repeated id is not an error checkov reports; it is a list somebody edited twice.
  it('names each check once', () => {
    const ids: readonly string[] = CHECKOV_CHECKS.map((check: CheckovCheck): string => check.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // The reason is what makes the audit re-readable when the pin moves and the catalogue is re-checked.
  it('records why every check is enabled', () => {
    const unexplained: readonly CheckovCheck[] = CHECKOV_CHECKS.filter(
      (check: CheckovCheck): boolean => check.reason.trim().length === 0,
    )
    expect(unexplained).toEqual([])
  })

  // Left off deliberately: each states a policy about how an environment is run rather than a defect in
  // how it is written, and a deliberately ephemeral environment fails all three on day one.
  it.each(['CKV_AWS_133', 'CKV_AWS_139', 'CKV_AWS_293'])(
    'leaves %s off, because it is a policy choice rather than a defect',
    (id: string) => {
      expect(CHECKOV_CHECKS.map((check: CheckovCheck): string => check.id)).not.toContain(id)
    },
  )

  // Left off because a fixture against the pinned image showed each failing a correct configuration:
  // a security-group rule that references another group, an absent argument whose default is already
  // TLS 1.2, and a load balancer behind a CDN. With no per-check opt-out, a check that blocks the
  // correct form is worse than none.
  it.each(['CKV_AWS_24', 'CKV_AWS_25', 'CKV_AWS_206', 'CKV_AWS_2', 'CKV_AWS_103'])(
    'leaves %s off, because it fails a correct configuration at this pin',
    (id: string) => {
      expect(CHECKOV_CHECKS.map((check: CheckovCheck): string => check.id)).not.toContain(id)
    },
  )
})

describe('checkovCheckList', () => {
  it('renders the catalogue as the comma separated value the flag takes', () => {
    expect(checkovCheckList().split(',')).toHaveLength(CHECKOV_CHECKS.length)
  })

  it('renders the identifiers rather than the reasons', () => {
    expect(checkovCheckList()).toContain('CKV_AWS_274')
  })

  it('renders no whitespace, which the flag would carry into the argument', () => {
    expect(checkovCheckList()).not.toMatch(/\s/)
  })
})

describe('failedCheckCount', () => {
  it('reads the tally off the scan summary', () => {
    expect(
      failedCheckCount(
        'terraform scan results:\nPassed checks: 83, Failed checks: 1, Skipped checks: 0\n',
      ),
    ).toBe(1)
  })

  it('reads a tally of none', () => {
    expect(failedCheckCount('Passed checks: 9, Failed checks: 0, Skipped checks: 0\n')).toBe(0)
  })

  // Output with no tally is a run that stopped before deciding, and must not read as a clean one.
  it('reports no tally for output that carries none', () => {
    expect(failedCheckCount('Traceback (most recent call last):\n')).toBeUndefined()
  })
})

describe('checksFor', () => {
  it('returns the whole catalogue for every curated provider together', () => {
    expect(checksFor([...curatedProviders()])).toEqual(CHECKOV_CHECKS)
  })

  it('returns only the checks bound to the providers asked for', () => {
    const [first] = CHECKOV_CHECKS
    const returned: readonly CheckovCheck[] = checksFor(first === undefined ? [] : [first.provider])
    expect(returned.length).toBeGreaterThan(0)
    expect(returned.length).toBeLessThanOrEqual(CHECKOV_CHECKS.length)
  })

  it('returns nothing for a provider with no enabled check', () => {
    expect(checksFor(['random', 'hcloud'])).toEqual([])
  })
})

describe('classifyProviders', () => {
  it('files a provider with enabled checks as curated', () => {
    expect(classifyProviders(['aws']).curated).toEqual(['aws'])
  })

  it('files a provider that declares no cloud resource as utility', () => {
    expect(classifyProviders(['random']).utility).toEqual(['random'])
  })

  it('files a provider the analyzer ships no check for as unsupported', () => {
    expect(classifyProviders(['hcloud']).unsupported).toEqual(['hcloud'])
  })

  // The case the gate refuses: a cloud the analyzer does cover, that nobody here has audited. Passing it
  // would report curated checks that never ran.
  it('files a provider on no list as unclassified', () => {
    expect(classifyProviders(['alicloud']).unclassified).toEqual(['alicloud'])
  })

  it('names each provider once, ordered, in one standing each', () => {
    const standing: ProviderClassification = classifyProviders([
      'random',
      'aws',
      'random',
      'hcloud',
      'aws',
    ])
    expect(standing).toEqual({
      curated: ['aws'],
      utility: ['random'],
      unsupported: ['hcloud'],
      audited: [],
      unclassified: [],
    })
  })

  it('classifies nothing for no providers', () => {
    expect(classifyProviders([])).toEqual({
      curated: [],
      utility: [],
      unsupported: [],
      audited: [],
      unclassified: [],
    })
  })
})

describe('the provider standings', () => {
  // A provider listed as having no checks while the catalogue enables one would be reported two ways.
  it('never list a curated provider as being without checks', () => {
    const contradictory: readonly string[] = [...PROVIDERS_WITHOUT_CHECKS.keys()].filter(
      (provider: string): boolean => curatedProviders().has(provider),
    )
    expect(contradictory).toEqual([])
  })
})
