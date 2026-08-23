// Programmatic surface of the ploaness CLI, so a fixture or a downstream tool can drive the gates
// without shelling out.

export { format } from './commands/format.js'
export { commitMessage, precommit } from './commands/hooks.js'
export { init } from './commands/init.js'
export { sync } from './commands/sync.js'
export { verify, verifyOne } from './commands/verify.js'
export * from './context.js'
export * from './exec.js'
export * from './gates.js'
export * from './report.js'
