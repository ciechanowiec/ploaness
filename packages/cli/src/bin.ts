#!/usr/bin/env node
import {
  DEFAULT_VERIFICATION_LEVEL,
  isVerificationLevel,
  parseComplianceReportArguments,
  parseSbomArguments,
  type VerificationLevel,
} from '@ploaness/governance'
import { commitMessage } from './commands/commit-message.js'
import { complianceReport } from './commands/compliance-report.js'
import { format } from './commands/format.js'
import { init } from './commands/init.js'
import { sbom } from './commands/sbom.js'
import { scope } from './commands/scope.js'
import { sync } from './commands/sync.js'
import { verify, verifyOne } from './commands/verify.js'
// The `ploaness` command. Argument handling is deliberately small: ploaness offers commands, not
// options that change what is checked. A verification level is a word, not a flag, and each level
// contains the one before it. Three flags exist and none reaches a rule: --enforce=false changes whether
// findings are fatal, and --verbose and --json change what is shown. There is no flag that skips a gate.
import { createRepository, type Member, memberAt, type Repository } from './context.js'
import { ALL_GATES, type Gate, gateById } from './gates.js'

// argv begins with the node binary and the script path; the command follows them.
const ARGV_COMMAND_OFFSET: number = 2
// Wide enough for the longest gate identifier, so the listing stays aligned.
const GATE_ID_COLUMN: number = 22

const USAGE: string = `ploaness, the quality harness for Payload CMS projects

  ploaness verify [quick|delta|full] [--enforce=false]
                                                   run verification; bare \`verify\` is quick
  ploaness scope [--json]                          show what delta's browser sweep covers here
  ploaness format                                  apply formatting and safe fixes
  ploaness sync                                    materialise the managed files
  ploaness init                                    scaffold the consumer wiring
  ploaness sbom --artifact <file> [--output <dir>] export a release dependency inventory
  ploaness compliance-report [--output <dir>]      write the shareable compliance report
  ploaness gate <id> [--verbose]                   run one gate at the delta level, for debugging
  ploaness gates                                   list the gates in run order, with their level
  ploaness commit-message <file|--range R|--all>   check one message, a range, or the history

quick runs the static gates, delta adds history, build, bundle and the browser suite with its sweep
scoped to the change, and full sweeps every route and story in every engine.
Report-only mode (--enforce=false) prints findings and exits 0. It is not a pass.
Verbose mode (--verbose) prints what the gate's tool wrote, passing or failing.`

const HELP_COMMANDS: ReadonlySet<string> = new Set<string>(['--help', '-h', 'help'])

const GATE_SCOPES: ReadonlySet<string> = new Set<string>(['repository', 'package', 'payload'])

// Wide enough for the longest scope name, so the titles beside them line up.
const GATE_SCOPE_COLUMN: number = 10

// Wide enough for the longest level a gate declares.
const LEVEL_COLUMN: number = 5

// `--scope` and `--ids` exist so a script can ask which gates judge a repository's shape rather than
// keeping its own copy of the answer. ploaness's own verification runs such a list, in an order it
// chooses deliberately; what it could not do before was notice a NEW repository-scope gate that nobody
// had added to it - which is the failure that let `arch` sit unrun while a cycle grew behind it.
const SCOPE_OPTION: string = '--scope='
const IDS_OPTION: string = '--ids'

const listGates = (rest: readonly string[]): number => {
  const requested: string | undefined = rest
    .find((argument: string): boolean => argument.startsWith(SCOPE_OPTION))
    ?.slice(SCOPE_OPTION.length)
  const selected: readonly Gate[] = ALL_GATES.filter(
    (gate: Gate): boolean => requested === undefined || gate.scope === requested,
  )
  for (const gate of selected) {
    if (rest.includes(IDS_OPTION)) {
      console.info(gate.id)
    } else {
      const columns: readonly string[] = [
        gate.level.padEnd(LEVEL_COLUMN),
        ` ${gate.id.padEnd(GATE_ID_COLUMN)}`,
        gate.scope.padEnd(GATE_SCOPE_COLUMN),
        gate.title,
      ]
      console.info(columns.join(' '))
    }
  }
  return 0
}

// A single gate names no member, so a member-scope gate is asked about the package the engineer is
// standing in. That is the only reading that stays useful in a workspace and is exactly today's
// behaviour in a single-package repository, where there is one member and it is the root.
const runOneGate = async (repository: Repository, id: string | undefined, isVerbose: boolean): Promise<number> => {
  const gate: Gate | undefined = id === undefined ? undefined : gateById(id)
  if (gate === undefined) {
    console.error(`unknown gate "${id ?? ''}". Run \`ploaness gates\` to list them.`)
    return 1
  }
  const member: Member | undefined = gate.scope === 'repository' ? undefined : memberAt(repository, process.cwd())
  return await verifyOne(repository, { gate, member }, isVerbose)
}

// One entry per command. The table is the list of commands the binary accepts, and each handler is
// small enough to read on its own - which the switch it replaced no longer was.
type CommandRunner = (repository: Repository, rest: readonly string[]) => number | Promise<number>

const levelOf = (rest: readonly string[]): VerificationLevel =>
  rest.find((argument: string): argument is VerificationLevel => isVerificationLevel(argument)) ??
  DEFAULT_VERIFICATION_LEVEL

const COMMANDS: Readonly<Record<string, CommandRunner>> = {
  verify: async (repository: Repository, rest: readonly string[]): Promise<number> =>
    await verify(repository, levelOf(rest)),
  scope: (repository: Repository, rest: readonly string[]): number => scope(repository, rest.includes(JSON_OPTION)),
  format: (repository: Repository): number => format(repository),
  sync: (repository: Repository): number => sync(repository),
  init: (repository: Repository): number => init(repository),
  sbom,
  'compliance-report': complianceReport,
  gates: (_repository: Repository, rest: readonly string[]): number => listGates(rest),
  gate: async (repository: Repository, rest: readonly string[]): Promise<number> =>
    await runOneGate(repository, rest[0], rest.includes(VERBOSE_OPTION)),
  'commit-message': (repository: Repository, rest: readonly string[]): number =>
    commitMessage(repository, rest[0], rest[1]),
}

// Each command owns its grammar. A global allowlist rejected the documented `commit-message --all` and
// `--range` modes while accepting a verification option on commands that do not use it; checking the
// whole shape also stops extra positional arguments and single-dash options from disappearing silently.
const ENFORCE_OPTION: string = '--enforce=false'
const VERBOSE_OPTION: string = '--verbose'
const JSON_OPTION: string = '--json'
const GATE_OPTIONS: ReadonlySet<string> = new Set<string>([VERBOSE_OPTION])
const RANGE_ARGUMENT_COUNT: number = 2

const hasDistinctMembersOf = (values: readonly string[], allowed: ReadonlySet<string>): boolean =>
  values.every((value: string): boolean => allowed.has(value)) && new Set<string>(values).size === values.length

const isCommitMessageArguments = (rest: readonly string[]): boolean => {
  const [mode, value] = rest
  if (mode === '--all') {
    return rest.length === 1
  }
  return mode === '--range'
    ? rest.length === RANGE_ARGUMENT_COUNT && value !== undefined && !value.startsWith('-')
    : rest.length === 1 && mode !== undefined && !mode.startsWith('-')
}

// At most one level, anywhere among the arguments, beside the report-only option.
const isVerifyArguments = (rest: readonly string[]): boolean => {
  const levels: readonly string[] = rest.filter((argument: string): boolean => isVerificationLevel(argument))
  const options: readonly string[] = rest.filter((argument: string): boolean => !isVerificationLevel(argument))
  return levels.length <= 1 && hasDistinctMembersOf(options, new Set<string>([ENFORCE_OPTION]))
}

const acceptsArguments: Readonly<Record<string, (rest: readonly string[]) => boolean>> = {
  verify: isVerifyArguments,
  scope: (rest: readonly string[]): boolean => hasDistinctMembersOf(rest, new Set<string>([JSON_OPTION])),
  format: (rest: readonly string[]): boolean => rest.length === 0,
  sync: (rest: readonly string[]): boolean => rest.length === 0,
  init: (rest: readonly string[]): boolean => rest.length === 0,
  sbom: (rest: readonly string[]): boolean => parseSbomArguments(rest) !== undefined,
  'compliance-report': (rest: readonly string[]): boolean => parseComplianceReportArguments(rest) !== undefined,
  // A scope must name one ploaness knows, so a typo lists nothing rather than silently listing
  // everything - which for a script asking "have I missed a gate" would answer yes when it should not.
  gates: (rest: readonly string[]): boolean =>
    rest.every(
      (argument: string): boolean =>
        argument === IDS_OPTION ||
        (argument.startsWith(SCOPE_OPTION) && GATE_SCOPES.has(argument.slice(SCOPE_OPTION.length))),
    ),
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
  const isEnforce: boolean = !rest.includes(ENFORCE_OPTION)
  return await runCommand(createRepository(process.cwd(), isEnforce), rest)
}

// A command outside a gate has nothing above it to catch a throw, so an unreadable package.json used to
// reach the user as a stack trace. The message is the finding; the trace is noise around it.
const reportFailure = (error: unknown): number => {
  console.error(error instanceof Error ? error.message : String(error))
  return 1
}

// Setting the exit code is how Node reports a verdict while still flushing stdout. `process.exit()`
// would truncate the report the gates just wrote.
//
// Neither half of this carries a suppression any more, and the pair is why the carve-out exists. The
// assignment tripped `functional/immutable-data` while `unicorn/no-process-exit` banned the other
// spelling, so a Node entry point had no legal way to report a non-zero verdict; the shipped config now
// states `process.exitCode` as an accessor that rule is not aimed at. `.catch()` tripped
// `unicorn/prefer-await`, and awaiting inside a `try` is what that rule asks for - it needs no `let`,
// so `functional/no-let` has nothing to say, and `functional/no-try-statements` is off everywhere.
const runToVerdict = async (): Promise<number> => {
  try {
    return await main()
  } catch (error) {
    return reportFailure(error)
  }
}

process.exitCode = await runToVerdict()
