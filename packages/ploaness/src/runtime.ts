// See eslint.js for why every entry point is re-exported through this package.
//
// The home for generic runtime helpers a governed project calls, as opposed to the configs and checks
// the rest of these entry points carry. One entry rather than one per helper, so a second helper does
// not mean a second export map, a second shim, and a second line in three `files` arrays.
//
// This subpath is reachable from `tests/**` alone. `ploaness` is a devDependency, and `arch` forbids
// `src/**` from importing one, so an APPLICATION imports `@ploaness/runtime` directly and declares it
// in `dependencies`. The re-export stays because a spec may legitimately reach it through the harness
// it already declares.
export { safeHref } from '@ploaness/runtime'
