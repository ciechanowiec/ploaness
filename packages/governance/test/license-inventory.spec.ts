import { describe, expect, it } from 'vitest'
import {
  coordinateOf,
  type InventoryPackage,
  licensesByCoordinate,
  parseLicenseInventory,
} from '../src/license-inventory.js'

const inventory: string = JSON.stringify({
  MIT: [
    {
      name: '@scope/kit',
      versions: ['1.0.0', '2.0.0'],
      paths: ['/store/@scope+kit@1.0.0', '/store/@scope+kit@2.0.0'],
      license: 'MIT',
      homepage: 'https://example.invalid/kit',
    },
  ],
  'GPL-3.0-only': [{ name: 'local-dir', versions: [null], paths: ['/store/local-dir'], license: 'GPL-3.0-only' }],
  Unknown: [{ name: 'bare', versions: ['0.1.0'] }],
})

describe('license inventory', () => {
  it('reads every package with its versions, paths, licence and homepage', () => {
    expect(parseLicenseInventory(inventory)).toEqual([
      {
        name: '@scope/kit',
        versions: ['1.0.0', '2.0.0'],
        license: 'MIT',
        paths: ['/store/@scope+kit@1.0.0', '/store/@scope+kit@2.0.0'],
        homepage: 'https://example.invalid/kit',
      },
      { name: 'local-dir', versions: [], license: 'GPL-3.0-only', paths: ['/store/local-dir'], homepage: undefined },
      { name: 'bare', versions: ['0.1.0'], license: 'Unknown', paths: [], homepage: undefined },
    ])
  })
  it('refuses text that is not an inventory', () => {
    expect(parseLicenseInventory('[]')).toBeUndefined()
    expect(parseLicenseInventory('not json')).toBeUndefined()
    expect(parseLicenseInventory(JSON.stringify({ MIT: 'not a list' }))).toEqual([])
  })
  it('indexes the licence of every installed version and skips unversioned directories', () => {
    const packages: readonly InventoryPackage[] = parseLicenseInventory(inventory) ?? []
    expect([...licensesByCoordinate(packages)]).toEqual([
      ['@scope/kit@1.0.0', 'MIT'],
      ['@scope/kit@2.0.0', 'MIT'],
      ['bare@0.1.0', 'Unknown'],
    ])
    expect(coordinateOf('@scope/kit', '1.0.0')).toBe('@scope/kit@1.0.0')
  })
})
