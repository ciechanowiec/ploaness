// What ploaness refuses by name, whatever a manifest declares as its licence.
//
// The licence allowlist judges an npm package by the identifier its own manifest carries, and that is
// the wrong question for three families. A driver is permissively licensed while the only server it can
// reach is not (the MongoDB driver is Apache 2.0; the MongoDB server is SSPL). A package downloads a
// binary at install or first run under terms its manifest never mentions (puppeteer fetches Chrome for
// Testing). And a container image has no manifest at all, so nothing judged it: a compose file could pull
// MinIO or Redis 8 through a harness that refuses an AGPL npm package. Retired analyzers are also
// refused when the harness already owns their checks.
//
// Every entry names the reason and the replacement, because a refusal that stops a build without saying
// what to use instead sends the reader to the same search this table already did. Where a project turned
// non-permissive at a known release, the entry carries that floor and earlier releases are left to the
// licence gate. No project setting widens or narrows the list: a rule a project can edit is not a rule.

/** One image repository ploaness refuses, and what a project pulls instead. */
export interface BlockedImage {
  /**
   * The repository in normalised form: no `docker.io/`, no `library/`, a registry host kept for any
   * other registry. A trailing `*` matches every repository under that prefix.
   */
  readonly repository: string
  /** The first tag the refusal applies to, when the repository was once permissively licensed. */
  readonly from?: string
  /** A tag pattern that stays allowed, for a repository publishing an open-source variant beside the default. */
  readonly allowedTag?: RegExp
  readonly reason: string
  readonly replacement: string
}

/** One npm package ploaness refuses, and what a project depends on instead. */
export interface BlockedPackage {
  /** The package name; a trailing `*` matches every name under that prefix, `@scope/*` a whole scope. */
  readonly name: string
  /** The first version the refusal applies to, when the package was once permissively licensed. */
  readonly from?: string
  readonly reason: string
  readonly replacement: string
}

/** One system package ploaness refuses in a Dockerfile install line. */
export interface BlockedSystemPackage {
  readonly name: string
  readonly reason: string
  readonly replacement: string
}

const MONGODB_REASON: string =
  'the MongoDB server is SSPL, which is not an open-source licence, and this exists only to reach it'
const MONGODB_REPLACEMENT: string = 'the postgres image with @payloadcms/db-postgres'

const REDIS_REASON: string =
  'Redis 7.4 onward is RSALv2, SSPLv1 or AGPLv3, none of which is a permissive open-source licence'
const REDIS_REPLACEMENT: string =
  'valkey/valkey, which the redis and ioredis clients speak to unchanged'

const ELASTIC_REASON: string =
  'Elastic binaries are Elastic License 2.0 from 7.11, and this exists only to reach them'
const ELASTIC_REPLACEMENT: string =
  'opensearchproject/opensearch and opensearchproject/opensearch-dashboards with @opensearch-project/opensearch'

const MINIO_REASON: string =
  'MinIO is AGPL and its community edition is archived, with no images and no security fixes'
const OBJECT_STORAGE_REPLACEMENT: string = 'rustfs/rustfs or chrislusf/seaweedfs'

const HASHICORP_REASON: string =
  'HashiCorp relicensed to the Business Source License, which is not open source'
const HASHICORP_REPLACEMENT: string =
  'openbao/openbao for Vault, ghcr.io/opentofu/opentofu for Terraform'

const PROPRIETARY_DATABASE_REASON: string =
  'a proprietary database server, for which Payload has no adapter'
const POSTGRES_REPLACEMENT: string = 'the postgres image'

const GHOSTSCRIPT_REASON: string = 'Ghostscript is AGPL, and this is a thin wrapper around it'
const PDF_REPLACEMENT: string = 'pdfjs-dist with @napi-rs/canvas'

const NOTHING_REPLACEMENT: string = 'nothing; a Payload project has no place for it'

/** The image repositories ploaness refuses, in the order the report lists them. */
export const BLOCKED_IMAGES: readonly BlockedImage[] = [
  { repository: 'mongo', reason: MONGODB_REASON, replacement: MONGODB_REPLACEMENT },
  { repository: 'mongodb/*', reason: MONGODB_REASON, replacement: MONGODB_REPLACEMENT },
  { repository: 'redis', from: '7.4', reason: REDIS_REASON, replacement: REDIS_REPLACEMENT },
  { repository: 'redis/*', reason: REDIS_REASON, replacement: REDIS_REPLACEMENT },
  { repository: 'redislabs/*', reason: REDIS_REASON, replacement: REDIS_REPLACEMENT },
  {
    repository: 'elasticsearch',
    from: '7.11',
    reason: ELASTIC_REASON,
    replacement: ELASTIC_REPLACEMENT,
  },
  { repository: 'kibana', from: '7.11', reason: ELASTIC_REASON, replacement: ELASTIC_REPLACEMENT },
  {
    repository: 'logstash',
    from: '7.11',
    reason: ELASTIC_REASON,
    replacement: ELASTIC_REPLACEMENT,
  },
  {
    repository: 'docker.elastic.co/*',
    from: '7.11',
    reason: ELASTIC_REASON,
    replacement: ELASTIC_REPLACEMENT,
  },
  { repository: 'minio/*', reason: MINIO_REASON, replacement: OBJECT_STORAGE_REPLACEMENT },
  { repository: 'quay.io/minio/*', reason: MINIO_REASON, replacement: OBJECT_STORAGE_REPLACEMENT },
  { repository: 'pgsty/minio', reason: MINIO_REASON, replacement: OBJECT_STORAGE_REPLACEMENT },
  {
    repository: 'localstack/*',
    reason:
      'the LocalStack community edition is archived, and the unified image needs an account token and is free ' +
      'only for non-commercial use',
    replacement: 'rustfs/rustfs for S3 and motoserver/moto for other AWS APIs',
  },
  {
    repository: 'gresau/localstack-persist',
    reason: 'a repackaging of the archived LocalStack community edition',
    replacement: 'rustfs/rustfs for S3 and motoserver/moto for other AWS APIs',
  },
  {
    repository: 'cockroachdb/cockroach',
    from: '24.3',
    reason: 'CockroachDB 24.3 onward is under a proprietary licence with mandatory telemetry',
    replacement: POSTGRES_REPLACEMENT,
  },
  {
    repository: 'hashicorp/vault',
    from: '1.15',
    reason: HASHICORP_REASON,
    replacement: HASHICORP_REPLACEMENT,
  },
  {
    repository: 'hashicorp/consul',
    from: '1.16',
    reason: HASHICORP_REASON,
    replacement: HASHICORP_REPLACEMENT,
  },
  {
    repository: 'hashicorp/nomad',
    from: '1.6',
    reason: HASHICORP_REASON,
    replacement: HASHICORP_REPLACEMENT,
  },
  {
    repository: 'hashicorp/terraform',
    from: '1.6',
    reason: HASHICORP_REASON,
    replacement: HASHICORP_REPLACEMENT,
  },
  {
    repository: 'hashicorp/packer',
    from: '1.10',
    reason: HASHICORP_REASON,
    replacement: HASHICORP_REPLACEMENT,
  },
  {
    repository: 'redpandadata/*',
    reason: 'Redpanda is under the Business Source License, which is not open source',
    replacement: 'apache/kafka or nats',
  },
  {
    repository: 'vectorized/*',
    reason: 'Redpanda is under the Business Source License, which is not open source',
    replacement: 'apache/kafka or nats',
  },
  {
    repository: 'timescale/timescaledb',
    allowedTag: /-oss(?:-|$)/,
    reason: 'the default Timescale images carry Timescale License code, which is not open source',
    replacement: 'a tag ending in -oss, or the postgres image',
  },
  {
    repository: 'timescale/timescaledb-ha',
    allowedTag: /-oss(?:-|$)/,
    reason: 'the default Timescale images carry Timescale License code, which is not open source',
    replacement: 'a tag ending in -oss, or the postgres image',
  },
  {
    repository: 'getsentry/*',
    from: '23.11',
    reason: 'self-hosted Sentry is under the Functional Source License, which is not open source',
    replacement: 'glitchtip/glitchtip, or Sentry as a service through the MIT @sentry SDKs',
  },
  {
    repository: 'n8nio/*',
    reason: 'n8n is under the Sustainable Use License, which is not open source',
    replacement: NOTHING_REPLACEMENT,
  },
  {
    repository: 'directus/directus',
    reason: 'Directus is under the Business Source License, which is not open source',
    replacement: 'Payload',
  },
  {
    repository: 'mcr.microsoft.com/mssql/*',
    reason: PROPRIETARY_DATABASE_REASON,
    replacement: POSTGRES_REPLACEMENT,
  },
  {
    repository: 'container-registry.oracle.com/database/*',
    reason: PROPRIETARY_DATABASE_REASON,
    replacement: POSTGRES_REPLACEMENT,
  },
  {
    repository: 'gvenzl/oracle-*',
    reason: PROPRIETARY_DATABASE_REASON,
    replacement: POSTGRES_REPLACEMENT,
  },
  {
    repository: 'ibmcom/db2',
    reason: PROPRIETARY_DATABASE_REASON,
    replacement: POSTGRES_REPLACEMENT,
  },
  {
    repository: 'icr.io/db2_community/*',
    reason: PROPRIETARY_DATABASE_REASON,
    replacement: POSTGRES_REPLACEMENT,
  },
  {
    repository: 'ghcr.io/apollographql/router',
    reason: 'the Apollo Router is Elastic License 2.0, which is not open source',
    replacement: '@graphql-hive/gateway or @graphql-mesh',
  },
  {
    repository: 'bitnami/*',
    reason:
      'the Bitnami catalogue was deleted in 2025, so a tag here cannot be pulled reproducibly',
    replacement: 'the upstream official image of the same service',
  },
  {
    repository: 'bitnamilegacy/*',
    reason: 'the Bitnami legacy images are frozen with unfixed vulnerabilities',
    replacement: 'the upstream official image of the same service',
  },
  {
    repository: 'bitnamisecure/*',
    reason: 'the Bitnami secure images publish only a latest tag, so a pull cannot be pinned',
    replacement: 'the upstream official image of the same service',
  },
  {
    repository: 'dxflrs/garage',
    reason: 'Garage is AGPL, and a permissively licensed object store exists',
    replacement: OBJECT_STORAGE_REPLACEMENT,
  },
  {
    repository: 'citusdata/citus',
    reason: 'Citus is AGPL, and plain PostgreSQL serves a Payload project',
    replacement: POSTGRES_REPLACEMENT,
  },
  {
    repository: 'grafana/grafana',
    reason: 'Grafana is AGPL, and a permissively licensed dashboard exists',
    replacement: 'persesdev/perses',
  },
  {
    repository: 'grafana/loki',
    reason: 'Loki is AGPL, and a permissively licensed log store exists',
    replacement: 'victoriametrics/victoria-logs',
  },
  {
    repository: 'grafana/tempo',
    reason: 'Tempo is AGPL, and a permissively licensed trace store exists',
    replacement: 'jaegertracing/jaeger',
  },
  {
    repository: 'grafana/mimir',
    reason: 'Mimir is AGPL, and a permissively licensed metrics store exists',
    replacement: 'prom/prometheus or victoriametrics/victoria-metrics',
  },
  {
    repository: 'plausible/*',
    reason: 'Plausible is AGPL, and a permissively licensed analytics service exists',
    replacement: 'ghcr.io/umami-software/umami',
  },
  {
    repository: 'metabase/metabase',
    reason: 'Metabase is AGPL',
    replacement: NOTHING_REPLACEMENT,
  },
]

/** The npm packages ploaness refuses, in the order the report lists them. */
export const BLOCKED_PACKAGES: readonly BlockedPackage[] = [
  {
    name: 'eslint-plugin-jsx-a11y',
    reason:
      'the retired JSX accessibility analyzer duplicates checks owned by the ploaness Oxlint gate',
    replacement: 'the harness-owned oxlint gate; remove the legacy plugin dependency',
  },
  {
    name: '@payloadcms/db-mongodb',
    reason: MONGODB_REASON,
    replacement: '@payloadcms/db-postgres',
  },
  { name: 'mongodb', reason: MONGODB_REASON, replacement: '@payloadcms/db-postgres' },
  { name: 'mongoose', reason: MONGODB_REASON, replacement: '@payloadcms/db-postgres' },
  {
    name: 'mongodb-memory-server*',
    reason: 'downloads the SSPL MongoDB server binary at install time',
    replacement: '@payloadcms/db-postgres against the compose database',
  },
  { name: '@mongodb-js/*', reason: MONGODB_REASON, replacement: '@payloadcms/db-postgres' },
  {
    name: 'mongodb-client-encryption',
    reason: MONGODB_REASON,
    replacement: '@payloadcms/db-postgres',
  },
  {
    name: '@elastic/elasticsearch',
    reason: ELASTIC_REASON,
    replacement: '@opensearch-project/opensearch',
  },
  {
    name: '@elastic/eui',
    reason:
      'Elastic UI is dual-licensed SSPL and Elastic License 2.0, neither of which is permissive',
    replacement: '@payloadcms/ui',
  },
  { name: 'elastic-apm-node', reason: ELASTIC_REASON, replacement: '@opentelemetry/sdk-node' },
  {
    name: 'puppeteer',
    reason: 'downloads Chrome for Testing under Google terms, which are not open source',
    replacement: 'playwright, or puppeteer-core pointed at the Chromium Playwright installs',
  },
  { name: 'pdf2pic', reason: GHOSTSCRIPT_REASON, replacement: PDF_REPLACEMENT },
  { name: 'node-gs', reason: GHOSTSCRIPT_REASON, replacement: PDF_REPLACEMENT },
  { name: 'ghostscript4js', reason: GHOSTSCRIPT_REASON, replacement: PDF_REPLACEMENT },
  { name: 'mupdf', reason: 'MuPDF is AGPL', replacement: PDF_REPLACEMENT },
  {
    name: 'n8n',
    reason: 'n8n is under the Sustainable Use License, which is not open source',
    replacement: NOTHING_REPLACEMENT,
  },
  {
    name: 'n8n-*',
    reason: 'an n8n extension serves only the Sustainable Use License host',
    replacement: NOTHING_REPLACEMENT,
  },
  {
    name: 'directus',
    reason: 'Directus is under the Business Source License, which is not open source',
    replacement: 'payload',
  },
  { name: 'mssql', reason: PROPRIETARY_DATABASE_REASON, replacement: 'pg' },
  { name: 'tedious', reason: PROPRIETARY_DATABASE_REASON, replacement: 'pg' },
  { name: 'oracledb', reason: PROPRIETARY_DATABASE_REASON, replacement: 'pg' },
  { name: 'ibm_db', reason: PROPRIETARY_DATABASE_REASON, replacement: 'pg' },
  {
    name: 'ua-parser-js',
    from: '2.0.0',
    reason: 'ua-parser-js 2 is AGPL with a paid exemption',
    replacement: 'ua-parser-js 1, or bowser',
  },
  {
    name: 'mapbox-gl',
    from: '2.0.0',
    reason: 'Mapbox GL JS 2 onward is under proprietary Mapbox terms',
    replacement: 'maplibre-gl',
  },
  {
    name: 'tinymce',
    from: '7.0.0',
    reason: 'TinyMCE 7 onward is GPL or commercial',
    replacement: '@payloadcms/richtext-lexical',
  },
  {
    name: '@ckeditor/*',
    reason: 'CKEditor 5 is GPL or commercial',
    replacement: '@payloadcms/richtext-lexical',
  },
  {
    name: 'highcharts',
    reason: 'Highcharts is under a proprietary licence',
    replacement: 'chart.js or echarts',
  },
  {
    name: '@apollo/gateway',
    from: '2.0.0',
    reason: 'Apollo Gateway 2 onward is Elastic License 2.0, which is not open source',
    replacement: '@graphql-hive/gateway',
  },
]

/** The system packages a Dockerfile may not install. */
export const BLOCKED_SYSTEM_PACKAGES: readonly BlockedSystemPackage[] = [
  { name: 'ghostscript', reason: 'Ghostscript is AGPL', replacement: PDF_REPLACEMENT },
  { name: 'mupdf', reason: 'MuPDF is AGPL', replacement: PDF_REPLACEMENT },
  { name: 'mupdf-tools', reason: 'MuPDF is AGPL', replacement: PDF_REPLACEMENT },
  { name: 'mongodb-org', reason: MONGODB_REASON, replacement: MONGODB_REPLACEMENT },
  { name: 'mongodb-org-server', reason: MONGODB_REASON, replacement: MONGODB_REPLACEMENT },
  { name: 'mongodb-mongosh', reason: MONGODB_REASON, replacement: MONGODB_REPLACEMENT },
]
