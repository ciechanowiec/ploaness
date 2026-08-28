// The bounds the harness places on its OWN outbound work, and the one combinator that applies them.
//
// This is the first async module among the rules, and it is here rather than in the CLI for the reason
// the split states: what it decides is a policy - how long the harness waits, and how many sockets it
// will hold open at once - and a policy expressed as a pure function can be asserted against, while the
// same policy expressed inline in a fetch call can only be observed by hanging. Nothing here performs
// I/O; the work is supplied by the caller, which is where the I/O stays.
//
// The bound that was missing cost more than the bound that was wrong. An unbounded fetch produces no
// output and no verdict, so on a team's CI a stuck gate is indistinguishable from a stuck build - and
// unlike a gate failure, nothing says which it is, because nothing ends.

/**
 * How long any single request to a package or image registry may take.
 *
 * Shared by both registry readers rather than stated twice. They ask different hosts different
 * questions, but "how long will the harness wait for an answer" is one decision, and two literals that
 * must stay equal will not stay equal.
 */
export const REQUEST_TIMEOUT_MS: number = 30_000

/**
 * How long a networked tool the harness shells out to may run before it is killed.
 *
 * Far longer than a single request, because the tool resolves a whole lockfile before it asks anything.
 * This is a bound on a hang rather than a performance budget: a healthy run never approaches it, and a
 * run that does has stopped making progress.
 */
export const NETWORKED_TOOL_TIMEOUT_MS: number = 300_000

/**
 * How many registry requests the harness holds open at once.
 *
 * A workspace declares hundreds of distinct coordinates, and asking for all of them at once opens a
 * socket per dependency - which the registry answers by rate-limiting, and which a corporate proxy
 * answers by dropping. Neither failure names its cause, so both arrive as "the registry was
 * unreachable" for a network that was reachable all along.
 */
export const REGISTRY_CONCURRENCY: number = 8

/**
 * Map over items with at most `limit` in flight, preserving input order.
 *
 * Windowed rather than a sliding pool, because a pool needs a shared cursor and this repository bans
 * the mutation that would take. A window costs the tail of each batch waiting on its slowest member,
 * which for short registry reads is a smaller price than the rule it would break.
 * @param items what to work through, in the order the results must come back in.
 * @param limit the most that may be in flight at once; a limit below one is read as one, since a
 * limit of zero would otherwise consume nothing and never finish.
 * @param work what to do with one item.
 * @returns every result, in the order of `items`.
 */
export const mapWithConcurrency = async <Item, Result>(
  items: readonly Item[],
  limit: number,
  work: (item: Item) => Promise<Result>,
): Promise<readonly Result[]> => {
  if (items.length === 0) {
    return []
  }
  const width: number = Math.max(1, limit)
  const inFlight: readonly Result[] = await Promise.all(
    items.slice(0, width).map(async (item: Item): Promise<Result> => await work(item)),
  )
  return [...inFlight, ...(await mapWithConcurrency(items.slice(width), limit, work))]
}
