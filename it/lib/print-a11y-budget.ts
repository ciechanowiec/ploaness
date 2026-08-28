// Prints the accessibility route budget as the managed sweep itself resolves it.
//
// The sweep is a Playwright spec against a running application, which this suite has neither of - so
// what is asserted here is the chain that feeds it: the project's `package.json`, the clamp in
// `readSettings`, the constant `@ploaness/config/a11y` derives, and the `ploaness/a11y` subpath the
// spec imports by name. Every one of those is a joint between two packages, and a broken export map or
// a clamp facing the wrong way is invisible from inside the workspace.
import { MAX_SWEEP_ROUTES } from 'ploaness/a11y'

process.stdout.write(`accessibilityRouteBudget=${String(MAX_SWEEP_ROUTES)}\n`)
