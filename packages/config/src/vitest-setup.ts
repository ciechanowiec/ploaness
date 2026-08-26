// The first setup file the shipped Vitest config loads. It does two things: it reads the project
// environment, and it installs the network guard.
//
// It imports node builtins and @ploaness/governance, and NOTHING ELSE. A setup file that lives inside
// node_modules/@ploaness/config resolves `vitest`, `fast-check`, and `@testing-library/*` to the
// harness's own copies rather than to the project's, so a hook, a matcher, or a global seed registered
// against one of those would attach to a module instance the suite never loads and silently do nothing.
// Resolving from the project root does not rescue it either: that yields a package's CommonJS entry
// while the suite loads its ESM one, which is two module records again. That is why the fast-check
// global seed stays in the project's own `vitest.setup.ts`, and it is the constraint an otherwise
// reasonable refactor of this file will break.
//
// Every decision lives in @ploaness/governance. What is left here is the interception, which is the one
// part that cannot be pure.
import dns from 'node:dns'
import { existsSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import {
  describeSocketTarget,
  findNetworkEscape,
  hostOfUrl,
  isRecord,
  localAddresses,
  type NetworkAttempt,
  RESOLVER_METHODS,
  runEnvironmentFiles,
} from '@ploaness/governance'

// The transports this module intercepts, described by what interception needs to know and nothing more.
// A precise signature per transport would be a second declaration of shapes node already owns, and the
// proxy below forwards arguments it never inspects.
type Intercepted = (...callArguments: never[]) => unknown

/** Reads one call's arguments into the attempt the policy judges. */
type ToAttempt = (callArguments: readonly unknown[]) => NetworkAttempt

// A predicate rather than an assertion. `typeof value === 'function'` narrows to a shape with no call
// signature, so every caller would otherwise have to assert - and an assertion is uncovered by the type
// coverage measurement this repository holds at 100%, which is the point of preferring the predicate.
const isIntercepted = (value: unknown): value is Intercepted => typeof value === 'function'

// Read here for the reason the Playwright config reads them: an integration spec boots the project,
// and a Payload configuration validates `process.env` as the module loads, so the spec dies on
// configuration rather than on code. A project could put this in its own `vitest.setup.ts` and many
// did, but then the promise that a gate running the application uses the real environment holds only
// for the projects that remembered. Nothing loaded here replaces a value already set, so a project
// that still loads them itself is unaffected, and a variable CI exported outranks both files.
//
// Vitest re-runs this module once per spec file. That costs nothing to repeat: a file that is read
// twice sets nothing the second time, because the first read already set it.
for (const file of runEnvironmentFiles(existsSync)) {
  process.loadEnvFile(file)
}

// Vitest re-runs a setup module once per spec file, while the builtins it patches live for the whole
// worker. Without a mark, each file would wrap the previous file's wrapper one layer deeper.
const GUARD_MARK: symbol = Symbol.for('ploaness.network-guard')

const MACHINE_ADDRESSES: ReadonlySet<string> = localAddresses(os.networkInterfaces())

const refuse = (attempt: NetworkAttempt): void => {
  const refusal: string | undefined = findNetworkEscape(attempt, MACHINE_ADDRESSES)
  if (refusal !== undefined) {
    throw new Error(refusal)
  }
}

// A proxy rather than a wrapper function, for two reasons that both come from what is being wrapped.
// `net.Socket.prototype.connect` is a method, so the receiver has to reach the original - and a proxy
// forwards it without the wrapper ever naming `this`. And `dns.lookup` announces its promisified shape
// through a symbol property, which a hand-written wrapper has to remember to copy and a proxy carries
// by construction, along with the function's name and arity.
const guard = (original: Intercepted, toAttempt: ToAttempt): Intercepted =>
  new Proxy(original, {
    // Annotated rather than inherited from `ProxyHandler`, whose own declaration types the receiver and
    // the argument list as `any`; taking that would put two `any` values into the single function every
    // network call in the suite passes through.
    apply: (target: Intercepted, receiver: unknown, callArguments: readonly unknown[]): unknown => {
      refuse(toAttempt(callArguments))
      const result: unknown = Reflect.apply(target, receiver, callArguments)
      return result
    },
    has: (target: Intercepted, key: string | symbol): boolean =>
      key === GUARD_MARK || Reflect.has(target, key),
  })

// Installed non-writable and non-configurable, so a project setup file or a spec body cannot put the
// original back. Installing it twice is not a no-op but an error, which is what the mark check prevents.
const install = (owner: object, key: string, toAttempt: ToAttempt): void => {
  const original: unknown = Reflect.get(owner, key)
  if (!isIntercepted(original) || Reflect.has(original, GUARD_MARK)) {
    return
  }
  Object.defineProperty(owner, key, {
    value: guard(original, toAttempt),
    writable: false,
    enumerable: Object.getOwnPropertyDescriptor(owner, key)?.enumerable ?? true,
    configurable: false,
  })
}

const firstArgumentOf = (callArguments: readonly unknown[]): string => {
  const [target]: readonly unknown[] = callArguments
  return typeof target === 'string' ? target : String(target)
}

const toLookupAttempt: ToAttempt = (callArguments) => ({
  api: 'lookup',
  host: firstArgumentOf(callArguments),
  destination: firstArgumentOf(callArguments),
})

const toResolveAttempt: ToAttempt = (callArguments) => ({
  api: 'resolve',
  host: firstArgumentOf(callArguments),
  destination: firstArgumentOf(callArguments),
})

// `fetch` accepts a string, a `URL`, or a `Request`, and each yields its address differently. A single
// `String(...)` over that union stringifies a `Request` to `[object Object]`, which would make the
// refusal name nothing a reader could act on.
const fetchTargetUrl = (target: unknown): string => {
  if (typeof target === 'string') {
    return target
  }
  if (target instanceof URL) {
    return target.href
  }
  const declared: unknown = isRecord(target) ? target['url'] : undefined
  return typeof declared === 'string' ? declared : ''
}

const toFetchAttempt: ToAttempt = (callArguments) => {
  const [target]: readonly unknown[] = callArguments
  const raw: string = fetchTargetUrl(target)
  return { api: 'fetch', host: hostOfUrl(raw), destination: raw }
}

// The chokepoint. Every TCP reach in Node passes through it - `net.connect`, the http and https agents,
// `tls.connect` (a TLSSocket inherits this method rather than declaring its own), http2, undici and so
// the global fetch, and every database driver. Guarding it alone would already be the whole rule.
install(net.Socket.prototype, 'connect', describeSocketTarget)

// Redundant with the socket guard for anything that goes on to connect, and worth having anyway: it
// names the host rather than the socket, and it catches a caller that resolves before deciding where to
// go.
install(dns, 'lookup', toLookupAttempt)
install(dns.promises, 'lookup', toLookupAttempt)

// The hole the socket guard does not cover. The resolver family queries a nameserver over UDP without
// ever creating a socket, which is how an SRV lookup leaves the machine with nothing to intercept.
//
// The module-level `dns.resolve*` functions are bound to a default Resolver instance, so patching them
// leaves `new dns.Resolver().resolveSrv(...)` reaching `Resolver.prototype` untouched - the exact hole
// this block exists to close, one constructor away. The prototypes are guarded too.
// Named without a presence check: both constructors are declared by node's own types, so an optional
// chain here would be a defence against a shape the runtime cannot have and the compiler already denies.
const resolverOwners: readonly object[] = [
  dns,
  dns.promises,
  dns.Resolver.prototype,
  dns.promises.Resolver.prototype,
]

for (const method of RESOLVER_METHODS) {
  for (const owner of resolverOwners) {
    install(owner, method, toResolveAttempt)
  }
}

// Left replaceable, unlike the two above. A DOM test environment swaps the globals between files, and a
// non-configurable `fetch` would break that swap. This layer exists for the message it produces; if it
// is replaced, the socket guard still refuses the request one layer down.
// Read through Reflect rather than as a bare name: a runtime without it would make the bare name a
// reference error rather than an absence to skip over.
const currentFetch: unknown = Reflect.get(globalThis, 'fetch')
if (isIntercepted(currentFetch) && !Reflect.has(currentFetch, GUARD_MARK)) {
  Object.defineProperty(globalThis, 'fetch', {
    value: guard(currentFetch, toFetchAttempt),
    writable: true,
    enumerable: false,
    configurable: true,
  })
}
