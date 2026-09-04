// The image readers, exercised on the syntax the three files actually use.
//
// A multi-stage build names its own stages in later `FROM` lines, a version is usually stated once in
// an `ARG`, and a compose service that builds carries an `image` that nothing pulls. Each of those is a
// finding a naive reader would raise about an image nobody fetches.
import { describe, expect, it } from 'vitest'
import {
  hasUnresolvedVariable,
  imageReferencesInComposeModel,
  imageReferencesInDockerfile,
  imageReferencesInWorkflow,
  logicalLines,
  systemPackagesInDockerfile,
} from '../src/container-images.js'

describe('logicalLines', (): void => {
  it('joinsABackslashContinuedCommand', (): void => {
    const lines: readonly string[] = logicalLines(
      'RUN apk add \\\n    curl \\\n    git\nCMD ["sh"]',
    )
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^RUN apk add\s+curl\s+git$/)
    expect(lines[1]).toBe('CMD ["sh"]')
  })
})

describe('imageReferencesInDockerfile', (): void => {
  it('skipsAStageNamedEarlierAndTheScratchBase', (): void => {
    const dockerfile: string = [
      'FROM node:22-alpine AS builder',
      'RUN npm ci',
      'FROM builder AS test',
      'FROM scratch',
      'COPY --from=builder /app /app',
    ].join('\n')
    expect(imageReferencesInDockerfile(dockerfile)).toStrictEqual(['node:22-alpine'])
  })

  it('substitutesAnArgDefaultInBothSpellings', (): void => {
    const dockerfile: string = [
      'ARG NODE_VERSION=22.12.0',
      'ARG VARIANT="bookworm-slim"',
      `FROM --platform=$BUILDPLATFORM node:\${NODE_VERSION}-$VARIANT`,
    ].join('\n')
    expect(imageReferencesInDockerfile(dockerfile)).toStrictEqual(['node:22.12.0-bookworm-slim'])
  })

  it('leavesAnArgWithoutADefaultInPlace', (): void => {
    expect(imageReferencesInDockerfile(`ARG BASE\nFROM \${BASE}`)).toStrictEqual([`\${BASE}`])
  })

  it('ignoresACommentedFrom', (): void => {
    expect(imageReferencesInDockerfile('# FROM mongo:7\nFROM postgres:18')).toStrictEqual([
      'postgres:18',
    ])
  })

  it('readsTheKeywordCaseInsensitively', (): void => {
    expect(imageReferencesInDockerfile('from Postgres:18 as db')).toStrictEqual(['Postgres:18'])
  })
})

describe('systemPackagesInDockerfile', (): void => {
  it('readsThePackagesAfterEveryInstallVerbInAChainedRun', (): void => {
    const dockerfile: string = [
      'RUN apt-get update && apt-get install -y --no-install-recommends \\',
      '    ghostscript=10.0.0~dfsg-11 \\',
      '    imagemagick/bookworm \\',
      '  && rm -rf /var/lib/apt/lists/*',
      'RUN apk add --no-cache mupdf-tools=1.23.7-r0; apk add curl',
    ].join('\n')
    expect(systemPackagesInDockerfile(dockerfile)).toStrictEqual([
      'ghostscript',
      'imagemagick',
      'mupdf-tools',
      'curl',
    ])
  })

  it('readsNothingFromARunThatInstallsNothing', (): void => {
    expect(systemPackagesInDockerfile('RUN echo ghostscript > /tmp/note')).toStrictEqual([])
  })
})

describe('imageReferencesInWorkflow', (): void => {
  it('readsServiceContainersJobContainersAndDockerActions', (): void => {
    const workflow: string = [
      'jobs:',
      '  verify:',
      '    container: node:22',
      '    services:',
      '      postgres:',
      "        image: 'postgres:18' # the database",
      '      storage:',
      '        image: rustfs/rustfs:1.0.0',
      '    steps:',
      '      - uses: docker://ghcr.io/example/action:v1',
      '      # image: mongo:7',
    ].join('\n')
    expect(imageReferencesInWorkflow(workflow)).toStrictEqual([
      'node:22',
      'postgres:18',
      'rustfs/rustfs:1.0.0',
      'ghcr.io/example/action:v1',
    ])
  })

  it('leavesAMappingFormContainerToItsImageLine', (): void => {
    const workflow: string = [
      '    container:',
      '      image: node:22',
      '      options: --cpus 1',
    ].join('\n')
    expect(imageReferencesInWorkflow(workflow)).toStrictEqual(['node:22'])
  })
})

describe('imageReferencesInComposeModel', (): void => {
  it('readsThePulledImagesAndSkipsABuiltService', (): void => {
    const model: string = JSON.stringify({
      services: {
        pgadmin: { image: 'blankus-pgadmin', build: { context: 'pgadmin' } },
        postgres: { image: 'postgres:18' },
        mail: { image: 'axllent/mailpit:v1.24.0' },
      },
    })
    expect(imageReferencesInComposeModel(model)).toStrictEqual([
      { service: 'mail', image: 'axllent/mailpit:v1.24.0' },
      { service: 'postgres', image: 'postgres:18' },
    ])
  })

  it('refusesTextThatIsNotAComposeModel', (): void => {
    expect(imageReferencesInComposeModel('not json')).toBeUndefined()
    expect(imageReferencesInComposeModel('{"version":"3"}')).toBeUndefined()
  })
})

describe('hasUnresolvedVariable', (): void => {
  it('flagsAReferenceStillCarryingAVariable', (): void => {
    expect(hasUnresolvedVariable(`node:\${NODE_VERSION}`)).toBe(true)
    expect(hasUnresolvedVariable(`\${{ matrix.image }}`)).toBe(true)
    expect(hasUnresolvedVariable('node:22')).toBe(false)
  })
})
