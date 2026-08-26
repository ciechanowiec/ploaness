// See eslint.js for why every entry point is re-exported through this package.
//
// The home for generic runtime helpers a governed project calls, as opposed to the configs and checks
// the rest of these entry points carry. One entry rather than one per helper, so a second helper does
// not mean a second export map, a second shim, and a second line in three `files` arrays.
export { safeHref } from '@ploaness/governance'
