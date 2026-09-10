import { describe, expect, it } from 'vitest'
import {
  checkovConfigsIn,
  isCheckovConfigFile,
  isTerraformFile,
  terraformFilesIn,
} from '../src/terraform-files.js'

describe('isTerraformFile', () => {
  it.each(['infra/main.tf', 'infra/envs/prod/variables.tf', 'infra/envs/prod/terraform.tfvars'])(
    'accepts %s',
    (file: string) => {
      expect(isTerraformFile(file)).toBe(true)
    },
  )

  // The one file whose job is to hold the values it tells a reader to replace.
  it('does not accept an example variables file', () => {
    expect(isTerraformFile('infra/envs/prod/terraform.tfvars.example')).toBe(false)
  })

  // JSON rather than HCL: the text rules would misread it, and the analyzer reads it anyway.
  it('does not accept the JSON spelling', () => {
    expect(isTerraformFile('infra/main.tf.json')).toBe(false)
  })

  it('does not accept an unrelated source file', () => {
    expect(isTerraformFile('src/index.ts')).toBe(false)
  })
})

describe('terraformFilesIn', () => {
  it('finds every tracked source, ordered', () => {
    const tracked: readonly string[] = ['infra/b.tf', 'src/index.ts', 'infra/a.tf']
    expect(terraformFilesIn(tracked)).toEqual(['infra/a.tf', 'infra/b.tf'])
  })

  it('finds nothing in a repository that ships no infrastructure', () => {
    expect(terraformFilesIn(['src/index.ts', 'README.md'])).toEqual([])
  })
})

describe('isCheckovConfigFile', () => {
  it.each(['.checkov.yaml', '.checkov.yml', '.checkov.json'])('accepts %s', (file: string) => {
    expect(isCheckovConfigFile(file)).toBe(true)
  })

  // At any depth: a configuration beside the sources shadows the rules just as one at the root does.
  it('accepts a configuration nested beside the sources', () => {
    expect(isCheckovConfigFile('infra/.checkov.yaml')).toBe(true)
  })

  it('does not accept an unrelated dotfile', () => {
    expect(isCheckovConfigFile('.editorconfig')).toBe(false)
  })
})

describe('checkovConfigsIn', () => {
  it('finds every tracked configuration, ordered', () => {
    const tracked: readonly string[] = ['infra/.checkov.yaml', 'src/index.ts', '.checkov.yml']
    expect(checkovConfigsIn(tracked)).toEqual(['.checkov.yml', 'infra/.checkov.yaml'])
  })

  it('finds nothing in a repository that commits none', () => {
    expect(checkovConfigsIn(['infra/main.tf'])).toEqual([])
  })
})
