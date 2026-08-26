#!/usr/bin/env node
import { commitMessage } from './commands/commit-message.js'
import { format } from './commands/format.js'
import { init } from './commands/init.js'
import { sync } from './commands/sync.js'
import { verify, verifyOne } from './commands/verify.js'
// The `ploaness` command. Argument handling is deliberately small: ploaness offers commands, not
// options that change what is checked. Two flags exist and neither reaches a rule: --enforce=false
// changes whether findings are fatal, and --verbose changes what is shown. There is no flag that skips
// a gate.
import { type Context, createContext } from './context.js'
import { ALL_GATES, type Gate, gateById } from './gates.js'

// argv begins with the node binary and the script path; the command follows them.
const ARGV_COMMAND_OFFSET: number = 2
// Wide enough for the longest gate identifier, so the listing stays aligned.
const GATE_ID_COLUMN: number = 22

const USAGE: string = `ploaness, the quality harness for Payload CMS projects

  ploaness verify [--extended] [--enforce=false]   run Default or Extended verification
  ploaness format                                  apply formatting and safe fixes
  ploaness sync                                    materialise the managed files
  ploaness init                                    scaffold the consumer wiring
  ploaness gate <id> [--verbose]                   run one gate, for debugging
  ploaness gates                                   list the gates in run order
  ploaness commit-message <file|--range R|--all>   check one message, a range, or the history

Report-only mode (--enforce=false) prints findings and exits 0. It is not a pass.
Verbose mode (--verbose) prints what the gate's tool wrote, passing or failing.`

const HELP_COMMANDS: ReadonlySet<string> = new Set<string>(['--help', '-h', 'help'])

const listGates = (): number => {
  for (const gate of ALL_GATES) {
    const scope: string = gate.isExtended ? 'extended' : 'default '
    console.info(`${scope}  ${gate.id.padEnd(GATE_ID_COLUMN)} ${gate.title}`)
  }
  return 0
}

const runOneGate = async (
  context: Context,
  id: string | undefined,
  isVerbose: boolean,
): Promise<number> => {
  const gate: Gate | undefined = id === undefined ? undefined : gateById(id)
  if (gate === undefined) {
    console.error(`unknown gate "${id ?? ''}". Run \`ploaness gates\` to list them.`)
    return 1
  }
  return await verifyOne(context, gate, isVerbose)
}

// One entry per command. The table is the list of commands the binary accepts, and each handler is
// small enough to read on its own - which the switch it replaced no longer was.
type CommandRunner = (context: Context, rest: readonly string[]) => number | Promise<number>

const COMMANDS: Readonly<Record<string, CommandRunner>> = {
  verify: async (context: Context, rest: readonly string[]): Promise<number> =>
    await verify(context, rest.includes('--extended')),
  format: (context: Context): number => format(context),
  sync: (context: Context): number => sync(context),
  init: (context: Context): number => init(context),
  gates: (): number => listGates(),
  gate: async (context: Context, rest: readonly string[]): Promise<number> =>
    await runOneGate(context, rest[0], rest.includes(VERBOSE_OPTION)),
  'commit-message': (context: Context, rest: readonly string[]): number =>
    commitMessage(context, rest[0], rest[1]),
}

// Each command owns its grammar. A global allowlist rejected the documented `commit-message --all` and
// `--range` modes while accepting `--extended` on commands that do not use it; checking the whole shape
// also stops extra positional arguments and single-dash options from disappearing silently.
const VERIFY_OPTIONS: ReadonlySet<string> = new Set<string>(['--extended', '--enforce=false'])
const VERBOSE_OPTION: string = '--verbose'
const GATE_OPTIONS: ReadonlySet<string> = new Set<string>([VERBOSE_OPTION])
const RANGE_ARGUMENT_COUNT: number = 2

const hasDistinctMembersOf = (values: readonly string[], allowed: ReadonlySet<string>): boolean =>
  values.every((value: string): boolean => allowed.has(value)) &&
  new Set<string>(values).size === values.length

const isCommitMessageArguments = (rest: readonly string[]): boolean => {
  const [mode, value] = rest
  if (mode === '--all') {
    return rest.length === 1
  }
  if (mode === '--range') {
    return rest.length === RANGE_ARGUMENT_COUNT && value !== undefined && !value.startsWith('-')
  }
  return rest.length === 1 && mode !== undefined && !mode.startsWith('-')
}

const acceptsArguments: Readonly<Record<string, (rest: readonly string[]) => boolean>> = {
  verify: (rest: readonly string[]): boolean => hasDistinctMembersOf(rest, VERIFY_OPTIONS),
  format: (rest: readonly string[]): boolean => rest.length === 0,
  sync: (rest: readonly string[]): boolean => rest.length === 0,
  init: (rest: readonly string[]): boolean => rest.length === 0,
  gates: (rest: readonly string[]): boolean => rest.length === 0,
  gate: (rest: readonly string[]): boolean => {
    const [id, ...options] = rest
    return id !== undefined && !id.startsWith('-') && hasDistinctMembersOf(options, GATE_OPTIONS)
  },
  'commit-message': isCommitMessageArguments,
}

const main = async (): Promise<number> => {
  const argv: readonly string[] = process.argv.slice(ARGV_COMMAND_OFFSET)
  const [command, ...rest] = argv
  if (command === undefined || HELP_COMMANDS.has(command)) {
    console.info(USAGE)
    return 0
  }
  // `Object.hasOwn`, not a bare index. The table is an object literal, so `ploaness toString` resolved
  // to `Object.prototype.toString` and ran it as though it were a command.
  if (!Object.hasOwn(COMMANDS, command)) {
    console.error(`unknown command "${command}"\n\n${USAGE}`)
    return 1
  }
  const accepts: ((rest: readonly string[]) => boolean) | undefined = acceptsArguments[command]
  const isAccepted: boolean = accepts?.(rest) ?? false
  if (!isAccepted) {
    console.error(`invalid arguments for "${command}"\n\n${USAGE}`)
    return 1
  }
  const runCommand: CommandRunner | undefined = COMMANDS[command]
  if (runCommand === undefined) {
    console.error(`unknown command "${command}"\n\n${USAGE}`)
    return 1
  }
  const isEnforce: boolean = !rest.includes('--enforce=false')
  return await runCommand(createContext(process.cwd(), isEnforce), rest)
}

// A command outside a gate has nothing above it to catch a throw, so an unreadable package.json used to
// reach the user as a stack trace. The message is the finding; the trace is noise around it.
const reportFailure = (error: unknown): number => {
  console.error(error instanceof Error ? error.message : String(error))
  return 1
}

// Setting the exit code is how Node reports a verdict while still flushing stdout. `process.exit()`
// would truncate the report the gates just wrote.
// One comment naming both rules rather than two stacked. A second `eslint-disable-next-line` makes the
// FIRST one's next line the comment rather than the code, which silently disarms it - a defect this
// repository has already had once.
// eslint-disable-next-line functional/immutable-data, unicorn/prefer-await -- see the note above
process.exitCode = await main().catch(reportFailure)
