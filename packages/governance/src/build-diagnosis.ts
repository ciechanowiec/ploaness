// Naming a build failure whose message points at the wrong layer.
//
// The `build` gate runs the project's own build script, which routes through the test-database wrapper
// so a build cannot read, or write, the database a developer is using. That isolation is worth having
// and it is also what surfaces a latent Next issue as an unreadable Postgres error: a page that reads
// the Payload Local API and uses no request-time API is PRERENDERED at build time, so it runs against
// the freshly created, schema-less database and dies with `relation "..." does not exist`.
//
// Nothing about that message says the page is the problem. A plain `next build` does not fail this way,
// because it reaches the development database, which has a schema from dev push-mode - so the natural
// reading is that the wrapper is broken. This module says what actually happened, and it is a
// DIAGNOSIS appended to a failure rather than a rule: the gate already failed, and would fail without
// it. That is why the pattern being wrong can cost a confusing extra line and nothing else.

/** A build-output pattern worth explaining, and the explanation. */
interface Diagnosis {
  readonly pattern: RegExp
  readonly hint: readonly string[]
}

// Matched on the shape Postgres itself prints, unquoted or quoted, rather than on any table name: the
// name is the project's and the message is the driver's.
const MISSING_RELATION: RegExp = /relation "?[\w.$]+"? does not exist/i

const PRERENDER_HINT: readonly string[] = [
  'a page that reads the Payload Local API was prerendered against the empty build database',
  'the build runs through the test-database wrapper, which creates a database with no schema, so a ' +
    'page rendered at build time finds no tables; a plain `next build` hides this by reaching the ' +
    'development database instead',
  'await `connection()` from `next/server` in the function that reads Payload, which makes the page ' +
    'render per request rather than at build time',
  "`export const dynamic = 'force-dynamic'` still works, but it has moved to the \"Caching " +
    '(Previous Model)" guide and is removed under Cache Components, so `connection()` is the current ' +
    'spelling',
]

const DIAGNOSES: readonly Diagnosis[] = [{ pattern: MISSING_RELATION, hint: PRERENDER_HINT }]

/**
 * Explain a build failure whose own message names the wrong cause.
 *
 * Returns nothing for output it does not recognise, which is the common case: this adds a paragraph to
 * a failure that already stands on its own, and says nothing rather than guessing.
 * @param output the build's combined stdout and stderr.
 * @returns hint lines to append to the gate's findings, in the order they were matched.
 */
export const diagnoseBuildFailure = (output: string): readonly string[] =>
  DIAGNOSES.flatMap((diagnosis: Diagnosis): readonly string[] =>
    diagnosis.pattern.test(output) ? diagnosis.hint : [],
  )
