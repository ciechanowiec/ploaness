// Where the network guard is installed, as the first setup file the shipped Vitest config loads.
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
import net from 'node:net'
import os from 'node:os'
import {
  describeSocketTarget,
  findNetworkEscape,
  hostOfUrl,
  localAddresses,
  RESOLVER_METHODS,
} from '@ploaness/governance'

// Vitest re-runs a setup module once per spec file, while the builtins it patches live for the whole
// worker. Without a mark, each file would wrap the previous file's wrapper one layer deeper.
const GUARD_MARK = Symbol.for('ploaness.network-guard')

const MACHINE_ADDRESSES = localAddresses(os.networkInterfaces())

const refuse = (attempt) => {
  const refusal = findNetworkEscape(attempt, MACHINE_ADDRESSES)
  if (refusal !== undefined) {
    throw new Error(refusal)
  }
}

const guard = (original, toAttempt) => {
  const guarded = function guardedByPloaness(...callArguments) {
    refuse(toAttempt(callArguments))
    return Reflect.apply(original, this, callArguments)
  }
  // Carried over rather than left behind: `dns.lookup` announces its promisified shape through a symbol
  // property, and a wrapper without it turns `promisify(dns.lookup)` into a different function.
  Object.defineProperties(guarded, Object.getOwnPropertyDescriptors(original))
  Object.defineProperty(guarded, GUARD_MARK, { value: true })
  return guarded
}

// Installed non-writable and non-configurable, so a project setup file or a spec body cannot put the
// original back. Installing it twice is not a no-op but an error, which is what the mark check prevents.
const install = (owner, key, toAttempt) => {
  const original = owner[key]
  if (typeof original !== 'function' || GUARD_MARK in original) {
    return
  }
  Object.defineProperty(owner, key, {
    value: guard(original, toAttempt),
    writable: false,
    enumerable: Object.getOwnPropertyDescriptor(owner, key)?.enumerable ?? true,
    configurable: false,
  })
}

const firstArgumentOf = (callArguments) => {
  const [target] = callArguments
  return typeof target === 'string' ? target : String(target)
}

const toLookupAttempt = (callArguments) => ({
  api: 'lookup',
  host: firstArgumentOf(callArguments),
  destination: firstArgumentOf(callArguments),
})

const toResolveAttempt = (callArguments) => ({
  api: 'resolve',
  host: firstArgumentOf(callArguments),
  destination: firstArgumentOf(callArguments),
})

const toFetchAttempt = (callArguments) => {
  const [target] = callArguments
  const raw = typeof target === 'string' ? target : String(target?.url ?? target ?? '')
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
RESOLVER_METHODS.forEach((method) => {
  install(dns, method, toResolveAttempt)
  install(dns.promises, method, toResolveAttempt)
})

// Left replaceable, unlike the two above. A DOM test environment swaps the globals between files, and a
// non-configurable `fetch` would break that swap. This layer exists for the message it produces; if it
// is replaced, the socket guard still refuses the request one layer down.
if (typeof globalThis.fetch === 'function' && !(GUARD_MARK in globalThis.fetch)) {
  globalThis.fetch = guard(globalThis.fetch, toFetchAttempt)
}
