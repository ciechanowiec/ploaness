#!/usr/bin/env node
import { commitMessage } from './commands/commit-message.js'
import { format } from './commands/format.js'
import { init } from './commands/init.js'
import { sync } from './commands/sync.js'
import { verify, verifyOne } from './commands/verify.js'
// The `ploaness` command. Argument handling is deliberately small: ploaness offers commands, not
// options that change what is checked. The one flag, --enforce=false, changes only whether findings are
// fatal. There is no flag that skips a gate.
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
  ploaness gate <id>                               run one gate, for debugging
  ploaness gates                                   list the gates in run order
  ploaness commit-message <file|--range R|--all>   check one message, a range, or the history

Report-only mode (--enforce=false) prints findings and exits 0. It is not a pass.`

const HELP_COMMANDS: ReadonlySet<string> = new Set<string>(['--help', '-h', 'help'])

const listGates = (): number => {
  for (const gate of ALL_GATES) {
    const scope: string = gate.isExtended ? 'extended' : 'default '
    console.info(`${scope}  ${gate.id.padEnd(GATE_ID_COLUMN)} ${gate.title}`)
  }
  return 0
}

const runOneGate = async (context: Context, id: string | undefined): Promise<number> => {
  const gate: Gate | undefined = id === undefined ? undefined : gateById(id)
  if (gate === undefined) {
    console.error(`unknown gate "${id ?? ''}". Run \`ploaness gates\` to list them.`)
    return 1
  }
  return await verifyOne(context, gate)
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
    await runOneGate(context, rest[0]),
  'commit-message': (context: Context, rest: readonly string[]): number =>
    commitMessage(context, rest[0], rest[1]),
}

// The flags this binary accepts, in full. Anything else beginning with a dash is refused rather than
// ignored: `--extend` silently ran default verification, and `--enforce=FALSE` silently enforced, which
// are the two ways a caller can believe it asked for something it did not get.
const KNOWN_FLAGS: ReadonlySet<string> = new Set<string>(['--extended', '--enforce=false'])

const unknownFlags = (argv: readonly string[]): readonly string[] =>
  argv.filter((token: string): boolean => token.startsWith('--') && !KNOWN_FLAGS.has(token))

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
  const flags: readonly string[] = unknownFlags(argv)
  if (flags.length > 0) {
    console.error(`unknown option(s): ${flags.join(', ')}\n\n${USAGE}`)
    return 1
  }
  const runCommand: CommandRunner | undefined = COMMANDS[command]
  if (runCommand === undefined) {
    console.error(`unknown command "${command}"\n\n${USAGE}`)
    return 1
  }
  const isEnforce: boolean = !argv.includes('--enforce=false')
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
