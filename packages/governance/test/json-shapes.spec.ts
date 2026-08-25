import { describe, expect, it } from 'vitest'
import {
  asOptionalText,
  asRecord,
  asStringRecord,
  asText,
  declaredDependencies,
  isArray,
  isRecord,
  readKey,
} from '../src/json-shapes.js'

describe('isRecord', () => {
  it('accepts a parsed object', () => {
    expect(isRecord({ name: 'ploaness' })).toBe(true)
  })

  it('rejects null, which typeof reports as an object', () => {
    expect(isRecord(null)).toBe(false)
  })

  it('rejects a primitive', () => {
    expect(isRecord('ploaness')).toBe(false)
  })

  // An array narrowed to a record before these functions were shared, and a caller reading a manifest
  // key that holds one decides for itself. Changing that here would change what every caller sees.
  it('accepts an array, as every caller was already written to expect', () => {
    expect(isRecord([])).toBe(true)
  })
})

describe('asRecord', () => {
  it('returns the object it was given', () => {
    expect(asRecord({ name: 'ploaness' })).toEqual({ name: 'ploaness' })
  })

  // A malformed manifest leaves a rule reading its defaults, which are the strict end of every setting.
  it('returns no keys for a value that is not an object', () => {
    expect(asRecord(undefined)).toEqual({})
  })
})

describe('asStringRecord', () => {
  it('keeps the keys whose values are strings', () => {
    expect(asStringRecord({ payload: '3.88.0' })).toEqual({ payload: '3.88.0' })
  })

  it('drops a key whose value is not a string', () => {
    expect(asStringRecord({ payload: '3.88.0', engines: { node: '>=26' } })).toEqual({
      payload: '3.88.0',
    })
  })

  it('returns no keys for a value that is not an object', () => {
    expect(asStringRecord('payload')).toEqual({})
  })
})

describe('readKey', () => {
  it('reads a key of a parsed object', () => {
    expect(readKey({ version: '1.0.0' }, 'version')).toBe('1.0.0')
  })

  it('reads undefined from a value that is not an object', () => {
    expect(readKey(undefined, 'version')).toBeUndefined()
  })
})

describe('isArray', () => {
  it('accepts an array', () => {
    expect(isArray(['src/**'])).toBe(true)
  })

  it('rejects a value that is not an array', () => {
    expect(isArray({ length: 0 })).toBe(false)
  })
})

describe('asText', () => {
  it('returns the string it was given', () => {
    expect(asText('3.88.0')).toBe('3.88.0')
  })

  it('returns an empty string for a value that is not text', () => {
    expect(asText(3)).toBe('')
  })
})

// A rule reads `undefined` as "nothing was declared, so there is nothing to apply". Reading it as the
// empty string instead would turn "ploaness pins no package manager" into "ploaness requires the empty
// string", which fails every project rather than none.
describe('asOptionalText', () => {
  it('returns the string it was given', () => {
    expect(asOptionalText('pnpm@11.9.0')).toBe('pnpm@11.9.0')
  })

  it('returns undefined rather than an empty string for a missing value', () => {
    expect(asOptionalText(undefined)).toBeUndefined()
  })

  it('keeps an empty string, which is a declared value', () => {
    expect(asOptionalText('')).toBe('')
  })
})

describe('declaredDependencies', () => {
  it('merges both dependency blocks into one reading', () => {
    expect(
      declaredDependencies({ dependencies: { next: '16.3.2' }, devDependencies: { pg: '8.23.0' } }),
    ).toEqual({ next: '16.3.2', pg: '8.23.0' })
  })

  it('lets the development block decide a name declared in both', () => {
    expect(
      declaredDependencies({ dependencies: { pg: '8.0.0' }, devDependencies: { pg: '8.23.0' } }),
    ).toEqual({ pg: '8.23.0' })
  })

  it('drops a declaration whose version is not text, which no manifest can install', () => {
    expect(declaredDependencies({ dependencies: { pg: 8 } })).toEqual({})
  })

  it('reads nothing out of a value that is not a manifest', () => {
    expect(declaredDependencies(undefined)).toEqual({})
  })
})
