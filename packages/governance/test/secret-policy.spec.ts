import { describe, expect, it } from 'vitest'
import { renderGitleaksConfig, type SecretException } from '../src/secret-policy.js'

const exception = (overrides: Partial<SecretException> = {}): SecretException => ({
  path: 'tests/fixtures/stripe-webhook.json',
  reason: 'fake Stripe test key; the checkout fixture asserts on its shape',
  ...overrides,
})

describe('renderGitleaksConfig', () => {
  // The load-bearing property: a declared entry may add a named exception and may never replace the
  // scanner's own rules. Without this line the allowlist would become a way to disable the scan.
  it('always extends the scanner default rules', () => {
    expect(renderGitleaksConfig([])).toContain('useDefault = true')
  })

  it('extends them even when the project declares exceptions', () => {
    expect(renderGitleaksConfig([exception()])).toContain('useDefault = true')
  })

  it('renders one allowlist per declared exception', () => {
    const rendered: string = renderGitleaksConfig([
      exception(),
      exception({ path: 'tests/other.json' }),
    ])
    expect(rendered.match(/\[\[allowlists\]\]/g)).toHaveLength(2)
  })

  it('carries the reason into the description, so the config explains itself', () => {
    expect(renderGitleaksConfig([exception()])).toContain('fake Stripe test key')
  })

  it('anchors the path, so an exception cannot excuse a longer path that merely starts the same', () => {
    const rendered: string = renderGitleaksConfig([exception({ path: 'tests/a.json' })])
    expect(rendered).toContain(String.raw`^tests/a\.json$`)
  })

  it('escapes a regex metacharacter in the path rather than honouring it', () => {
    expect(renderGitleaksConfig([exception({ path: 'tests/a.b.json' })])).toContain(
      String.raw`a\.b\.json`,
    )
  })

  it('escapes a quotation mark in the reason rather than breaking the document', () => {
    const rendered: string = renderGitleaksConfig([exception({ reason: 'the "fake" key' })])
    expect(rendered).toContain(String.raw`\"fake\"`)
  })

  it('renders a valid config when the project declares nothing', () => {
    expect(renderGitleaksConfig([])).not.toContain('[[allowlists]]')
  })
})
