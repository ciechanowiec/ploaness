// The refusal rule, exercised on the spellings a repository actually writes.
//
// The cases that matter are the ones a name-keyed list would get wrong: the same image written four
// ways, a tag below a floor that must stay allowed, a tag that floats past the floor and must not, and
// a package whose own licence is fine while its newest major is not.
import { describe, expect, it } from 'vitest'
import {
  describeRefusal,
  type FreshnessScope,
  type ImageReference,
  isMutableImageReference,
  packagesInLicenseInventory,
  parseImageReference,
  type Refusal,
  refuseImage,
  refuseInstalledPackages,
  refusePackage,
  refuseSystemPackages,
  scopeFreshness,
} from '../src/blocklist.js'
import { BLOCKED_IMAGES, BLOCKED_PACKAGES, type BlockedImage } from '../src/blocklist-entries.js'
import type { DependencyStatus } from '../src/dependency-freshness.js'

const status = (name: string, latest: string, latestLicense?: string): DependencyStatus => ({
  name,
  owner: 'package.json',
  current: '1.0.0',
  isInherited: false,
  latest,
  ...(latestLicense !== undefined && { latestLicense }),
})

describe('parseImageReference', (): void => {
  it('normalisesEverySpellingOfAnOfficialImage', (): void => {
    const spellings: readonly string[] = [
      'mongo',
      'library/mongo',
      'docker.io/mongo',
      'docker.io/library/mongo',
      'index.docker.io/library/mongo:7',
    ]
    expect(
      spellings.map((raw: string): string => parseImageReference(raw).repository),
    ).toStrictEqual(['mongo', 'mongo', 'mongo', 'mongo', 'mongo'])
  })

  it('keepsAForeignRegistryHostAndDropsTheDockerHubOne', (): void => {
    expect(parseImageReference('quay.io/minio/minio:latest').repository).toBe('quay.io/minio/minio')
    expect(parseImageReference('docker.io/bitnami/redis').repository).toBe('bitnami/redis')
  })

  it('separatesTheTagFromARegistryPort', (): void => {
    const reference: ImageReference = parseImageReference('localhost:5000/team/app:1.2.3')
    expect(reference).toStrictEqual({
      raw: 'localhost:5000/team/app:1.2.3',
      repository: 'localhost:5000/team/app',
      tag: '1.2.3',
      digest: undefined,
    })
  })

  it('readsADigestBesideOrInsteadOfATag', (): void => {
    const digest: string = `sha256:${'a'.repeat(64)}`
    expect(parseImageReference(`postgres:18@${digest}`).digest).toBe(digest)
    expect(parseImageReference(`postgres@${digest}`).tag).toBeUndefined()
  })
})

describe('isMutableImageReference', (): void => {
  it('refusesNoTagAndTheLatestTag', (): void => {
    expect(isMutableImageReference('postgres')).toBe(true)
    expect(isMutableImageReference('dpage/pgadmin4:latest')).toBe(true)
  })

  it('acceptsATagOrADigest', (): void => {
    expect(isMutableImageReference('postgres:18')).toBe(false)
    expect(isMutableImageReference(`postgres@sha256:${'0'.repeat(64)}`)).toBe(false)
  })
})

describe('refuseImage', (): void => {
  it('refusesMongoDbHoweverItIsSpelled', (): void => {
    expect(refuseImage('docker.io/library/mongo:7.0.14')?.reason).toContain('SSPL')
    expect(refuseImage('mongodb/mongodb-community-server:7.0-ubi8')?.reason).toContain('SSPL')
  })

  it('leavesRedisBelowTheFloorToTheLicenceGate', (): void => {
    expect(refuseImage('redis:7.2.4')).toBeUndefined()
    expect(refuseImage('redis:7.2.4-alpine')).toBeUndefined()
  })

  it('refusesRedisAtAndPastTheFloor', (): void => {
    expect(refuseImage('redis:7.4.0')?.replacement).toContain('valkey')
    expect(refuseImage('redis:8.0.1')).toBeDefined()
  })

  // `redis:7` resolves to 7.4.x today, and `redis:latest` to whatever is newest; neither proves it sits
  // below the floor, so both are refused rather than passed on a guess.
  it('refusesATagThatCannotBePlacedAgainstTheFloor', (): void => {
    expect(refuseImage('redis:7')).toBeDefined()
    expect(refuseImage('redis:alpine')).toBeDefined()
    expect(refuseImage('redis:latest')).toBeDefined()
    expect(refuseImage('redis')).toBeDefined()
  })

  it('appliesTheFloorUnderAForeignRegistryPrefix', (): void => {
    expect(refuseImage('docker.elastic.co/elasticsearch/elasticsearch:7.10.2')).toBeUndefined()
    expect(refuseImage('docker.elastic.co/elasticsearch/elasticsearch:8.15.0')).toBeDefined()
  })

  it('allowsTheOpenSourceTimescaleVariantAndRefusesTheDefault', (): void => {
    expect(refuseImage('timescale/timescaledb-ha:pg16-ts2.14-oss-latest')).toBeUndefined()
    expect(refuseImage('timescale/timescaledb:2.14.2-pg16-oss')).toBeUndefined()
    expect(refuseImage('timescale/timescaledb:2.14.2-pg16')).toBeDefined()
  })

  it('refusesAWholeNamespace', (): void => {
    expect(refuseImage('bitnami/postgresql:16.3.0')?.reason).toContain('Bitnami')
    expect(refuseImage('bitnamilegacy/minio:2025.7.23')).toBeDefined()
  })

  it('passesTheImagesAPayloadProjectPulls', (): void => {
    const allowed: readonly string[] = [
      'postgres:18',
      'valkey/valkey:8.1',
      'rustfs/rustfs:1.0.0',
      'opensearchproject/opensearch:2.19.0',
      'dpage/pgadmin4:9.4',
      'axllent/mailpit:v1.24.0',
    ]
    expect(allowed.map((raw: string): Refusal | undefined => refuseImage(raw))).toStrictEqual(
      allowed.map((): undefined => undefined),
    )
  })

  it('namesAReplacementForEveryEntry', (): void => {
    expect(
      BLOCKED_IMAGES.every(
        (entry: BlockedImage): boolean => entry.replacement.length > 0 && entry.reason.length > 0,
      ),
    ).toBe(true)
  })
})

describe('refusePackage', (): void => {
  it.each(['6.10.2', '7.0.0'])('refuses the retired JSX analyzer at version %s', (version) => {
    expect(refusePackage('eslint-plugin-jsx-a11y', version)?.replacement).toContain('oxlint gate')
  })

  it('keeps the retired package refusal specific to its identity', () => {
    expect(refusePackage('oxlint', '1.81.0')).toBeUndefined()
    expect(refusePackage('@biomejs/biome', '2.5.11')).toBeUndefined()
    expect(refusePackage('eslint', '10.9.1')).toBeUndefined()
    expect(refusePackage('eslint-plugin-jsx-a11y-x', '0.2.0')).toBeUndefined()
  })

  it('refusesADriverWhoseOnlyServerIsNotOpenSource', (): void => {
    expect(refusePackage('mongoose', '8.5.1')?.replacement).toBe('@payloadcms/db-postgres')
    expect(refusePackage('@payloadcms/db-mongodb', '3.88.0')).toBeDefined()
  })

  it('matchesAScopeAndAPrefix', (): void => {
    expect(refusePackage('@mongodb-js/saslprep', '1.1.9')).toBeDefined()
    expect(refusePackage('mongodb-memory-server-core', '10.1.4')).toBeDefined()
    expect(refusePackage('@ckeditor/ckeditor5-core', '43.0.0')).toBeDefined()
  })

  it('leavesAVersionBelowTheFloorToTheLicenceGate', (): void => {
    expect(refusePackage('ua-parser-js', '1.0.40')).toBeUndefined()
    expect(refusePackage('mapbox-gl', '1.13.3')).toBeUndefined()
  })

  it('refusesAVersionAtAndPastTheFloor', (): void => {
    expect(refusePackage('ua-parser-js', '2.0.0')?.reason).toContain('AGPL')
    expect(refusePackage('tinymce', '7.3.0')).toBeDefined()
  })

  it('passesAPackageOutsideTheList', (): void => {
    expect(refusePackage('pg', '8.23.0')).toBeUndefined()
    expect(refusePackage('mongodb-uri', '0.9.7')).toBeUndefined()
    expect(refusePackage('redis', '5.6.0')).toBeUndefined()
  })

  it('namesAReplacementForEveryEntry', (): void => {
    expect(BLOCKED_PACKAGES.every((entry): boolean => entry.replacement.length > 0)).toBe(true)
  })
})

describe('refuseSystemPackages', (): void => {
  it('refusesGhostscriptInAContinuedInstallLine', (): void => {
    const dockerfile: string = [
      'FROM node:22-bookworm',
      'RUN apt-get update && apt-get install -y --no-install-recommends \\',
      '    ghostscript \\',
      '    imagemagick',
    ].join('\n')
    expect(
      refuseSystemPackages(dockerfile).map((refusal: Refusal): string => refusal.subject),
    ).toStrictEqual(['ghostscript'])
  })

  it('passesADockerfileThatInstallsNothingRefused', (): void => {
    expect(
      refuseSystemPackages('FROM node:22\nRUN apk add --no-cache libc6-compat\n'),
    ).toStrictEqual([])
  })
})

describe('packagesInLicenseInventory', (): void => {
  it('readsEveryGroupOfThePnpmInventory', (): void => {
    const inventory: string = JSON.stringify({
      MIT: [{ name: 'pg', versions: ['8.23.0'], license: 'MIT' }],
      'Apache-2.0': [{ name: 'mongodb', versions: ['6.8.0', '6.9.0'], license: 'Apache-2.0' }],
    })
    expect(packagesInLicenseInventory(inventory)).toStrictEqual([
      { name: 'pg', versions: ['8.23.0'] },
      { name: 'mongodb', versions: ['6.8.0', '6.9.0'] },
    ])
  })

  it('refusesTextThatIsNotAnInventory', (): void => {
    expect(packagesInLicenseInventory('not json')).toBeUndefined()
    expect(packagesInLicenseInventory('[]')).toBeUndefined()
  })
})

describe('refuseInstalledPackages', (): void => {
  it('refusesEachRefusedVersionAndNoOther', (): void => {
    const refusals: readonly Refusal[] = refuseInstalledPackages([
      { name: 'ua-parser-js', versions: ['1.0.40', '2.0.3'] },
      { name: 'pg', versions: ['8.23.0'] },
    ])
    expect(refusals.map((refusal: Refusal): string => refusal.subject)).toStrictEqual([
      'ua-parser-js@2.0.3',
    ])
  })
})

describe('scopeFreshness', (): void => {
  it('keepsTheBoundShortOfARefusedNewestRelease', (): void => {
    const scope: FreshnessScope = scopeFreshness([
      status('ua-parser-js', '2.0.3', 'AGPL-3.0-or-later'),
    ])
    expect(scope.measurable).toStrictEqual([])
    expect(scope.refused[0]?.note).toContain('refused')
  })

  it('keepsTheBoundShortOfANewestReleaseLicensedOutsideTheAllowlist', (): void => {
    const scope: FreshnessScope = scopeFreshness([status('left-pad', '3.0.0', 'SSPL-1.0')])
    expect(scope.measurable).toStrictEqual([])
    expect(scope.refused[0]?.note).toContain('SSPL-1.0')
  })

  it('measuresEverythingElse', (): void => {
    const statuses: readonly DependencyStatus[] = [
      status('pg', '8.23.0', 'MIT'),
      status('unlabelled', '2.0.0'),
    ]
    expect(scopeFreshness(statuses)).toStrictEqual({ measurable: statuses, refused: [] })
  })
})

describe('describeRefusal', (): void => {
  it('namesTheLocationTheSubjectTheReasonAndTheReplacement', (): void => {
    const refusal: Refusal = { subject: 'mongo:7', reason: 'SSPL', replacement: 'postgres' }
    expect(describeRefusal(refusal, 'Dockerfile')).toBe('Dockerfile: mongo:7 - SSPL; use postgres')
  })
})
