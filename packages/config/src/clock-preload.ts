// The application's clock during verification: started at one fixed instant, then advancing normally.
//
// Loaded through `NODE_OPTIONS=--import`, so it reaches every process of the verification tree - the
// build, the seeding command, every application server and every worker they start - before any of
// their own code runs. A page prerendered by the build and the same page rendered by the server then
// read the same date on every machine and every day, while sessions, cookie expiry and revalidation keep
// working because time still passes.
//
// Self-contained on purpose. It is evaluated at the start of every process in the tree, and loading the
// governance package for one subtraction would cost each of them that package's whole import graph.
// The `it/` clock contracts hold the variable name to the one governance declares: the CLI sets that
// variable, and a mismatch leaves the fixture's pages at today's year.

/** The variable naming the instant, `CLOCK_ENVIRONMENT_VARIABLE` in `@ploaness/governance`. */
const CLOCK_VARIABLE: string = 'PLOANESS_CLOCK'

const declared: string | undefined = process.env[CLOCK_VARIABLE]
const instant: number = declared === undefined ? Number.NaN : Date.parse(declared)

if (!Number.isNaN(instant)) {
  const RealDate: DateConstructor = Date
  const startedAt: number = RealDate.now()
  const now = (): number => instant + (RealDate.now() - startedAt)
  // A proxy rather than a subclass, so `Date()` called as a function still answers a string and
  // `instanceof Date` still holds for every date created before or after the shift.
  const shifted: DateConstructor = new Proxy(RealDate, {
    construct: (target: DateConstructor, parameters: readonly unknown[], newTarget: unknown): object =>
      Reflect.construct(target, parameters.length === 0 ? [now()] : parameters, newTarget as NewableFunction) as object,
    apply: (): string => new RealDate(now()).toString(),
    get: (target: DateConstructor, property: string | symbol, receiver: unknown): unknown =>
      property === 'now' ? now : Reflect.get(target, property, receiver),
  })
  // Redefined rather than assigned, keeping the global's own writable and non-enumerable attributes.
  Object.defineProperty(globalThis, 'Date', { value: shifted })
}

export {}
