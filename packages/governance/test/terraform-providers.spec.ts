import { describe, expect, it } from 'vitest'
import {
  type ProviderDeclaration,
  providerDeclarationsIn,
  providersOf,
  resourceCountOf,
} from '../src/terraform-providers.js'

const providersNamed = (source: string): readonly string[] =>
  providerDeclarationsIn(source).map(
    (declaration: ProviderDeclaration): string => declaration.provider,
  )

describe('providerDeclarationsIn', () => {
  it('reads the provider off a resource type', () => {
    const [found] = providerDeclarationsIn(
      'resource "aws_iam_role" "deploy" {\n  name = "deploy"\n}\n',
    )
    expect(found).toEqual({ line: 1, provider: 'aws', subject: 'aws_iam_role', kind: 'resource' })
  })

  it('reads a data source the same way', () => {
    const [found] = providerDeclarationsIn('data "google_iam_policy" "noauth" {}\n')
    expect(found).toEqual({
      line: 1,
      provider: 'google',
      subject: 'google_iam_policy',
      kind: 'data',
    })
  })

  // A provider block declares nothing the analyzer can judge, but it does name a provider, and a
  // provider nobody classified must be refused however it enters the tree.
  it('reads a provider block, naming it as such', () => {
    const [found] = providerDeclarationsIn('provider "hcloud" {\n  token = var.token\n}\n')
    expect(found).toEqual({
      line: 1,
      provider: 'hcloud',
      subject: 'provider "hcloud"',
      kind: 'provider',
    })
  })

  it('reports the line each declaration sits on, in order', () => {
    const source: string = [
      'provider "aws" {}',
      '',
      'resource "aws_s3_bucket" "media" {}',
      'data "aws_caller_identity" "current" {}',
    ].join('\n')
    expect(
      providerDeclarationsIn(source).map(
        (declaration: ProviderDeclaration): number => declaration.line,
      ),
    ).toEqual([1, 3, 4])
  })

  // The beta provider declares the same resource types; its block must not read as a second cloud.
  it('files the beta google provider under google', () => {
    expect(providersNamed('provider "google-beta" {}\n')).toEqual(['google'])
  })

  it('ignores a declaration commented out in the HCL spelling', () => {
    expect(providersNamed('# resource "alicloud_instance" "web" {}\n')).toEqual([])
  })

  it('ignores a declaration commented out in the C spelling', () => {
    expect(providersNamed('/*\nresource "alicloud_instance" "web" {}\n*/\n')).toEqual([])
  })

  it('does not read a resource named inside a string', () => {
    expect(
      providersNamed('locals {\n  note = "resource \\"alicloud_instance\\" here"\n}\n'),
    ).toEqual([])
  })

  // The header pattern admits a type with no underscore, and such a type names its provider directly.
  it('reads a type with no underscore as the provider itself', () => {
    expect(providersNamed('resource "unprefixed" "one" {}\n')).toEqual(['unprefixed'])
  })

  it('finds nothing in a file of variables and outputs', () => {
    expect(
      providerDeclarationsIn(
        'variable "region" {\n  type = string\n}\n\noutput "region" {\n  value = var.region\n}\n',
      ),
    ).toEqual([])
  })
})

describe('providersOf', () => {
  it('names each provider once, ordered', () => {
    const declarations: readonly ProviderDeclaration[] = providerDeclarationsIn(
      [
        'resource "random_password" "db" {}',
        'resource "aws_db_instance" "db" {}',
        'resource "aws_s3_bucket" "media" {}',
      ].join('\n'),
    )
    expect(providersOf(declarations)).toEqual(['aws', 'random'])
  })

  it('names nothing for no declarations', () => {
    expect(providersOf([])).toEqual([])
  })
})

describe('resourceCountOf', () => {
  it('counts resources and data sources but not provider blocks', () => {
    const declarations: readonly ProviderDeclaration[] = providerDeclarationsIn(
      [
        'provider "aws" {}',
        'resource "aws_s3_bucket" "media" {}',
        'data "aws_region" "current" {}',
      ].join('\n'),
    )
    expect(resourceCountOf(declarations)).toBe(2)
  })
})
