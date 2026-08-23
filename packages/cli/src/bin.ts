#!/usr/bin/env node
import { format } from './commands/format.js'
import { commitMessage, precommit } from './commands/hooks.js'
import { init } from './commands/init.js'
import { sync } from './commands/sync.js'
import { verify, verifyOne } from './commands/verify.js'
// The `ploaness` command. Argument handling is deliberately small: ploaness offers commands, not
// options that change what is checked. The one flag, --enforce=false, changes only whether findings are
// fatal. There is no flag that skips a gate.
import { type Context, createContext } from './context.js'
import { ALL_GATES, type Gate, gateById } from './gates.js'

const USAGE: string = `ploaness, the quality harness for Payload CMS projects

  ploaness verify [--extended] [--enforce=false]   run Default or Extended verification
  ploaness format                                  apply formatting and safe fixes
  ploaness sync                                    materialise the managed files
  ploaness init                                    scaffold the consumer wiring
  ploaness gate <id>                               run one gate, for debugging
  ploaness gates                                   list the gates in run order
  ploaness precommit                               the pre-commit hook entry point
  ploaness commit-message <file|--range R|--all>   the commit-message entry point

Report-only mode (--enforce=false) prints findings and exits 0. It is not a pass.`

const main = async (): Promise<number> => {
  const argv: readonly string[] = process.argv.slice(2)
  const [command, ...rest] = argv
  const enforce: boolean = !argv.includes('--enforce=false')
  const context: Context = createContext(process.cwd(), enforce)

  switch (command) {
    case undefined:
    case '--help':
    case '-h':
    case 'help': {
      console.info(USAGE)
      return 0
    }
    case 'verify': {
      return await verify(context, rest.includes('--extended'))
    }
    case 'format': {
      return format(context)
    }
    case 'sync': {
      return sync(context)
    }
    case 'init': {
      return init(context)
    }
    case 'gates': {
      for (const gate of ALL_GATES) {
        console.info(
          `${gate.extended ? 'extended' : 'default '}  ${gate.id.padEnd(22)} ${gate.title}`,
        )
      }
      return 0
    }
    case 'gate': {
      const id: string | undefined = rest[0]
      const gate: Gate | undefined = id === undefined ? undefined : gateById(id)
      if (gate === undefined) {
        console.error(`unknown gate "${id ?? ''}". Run \`ploaness gates\` to list them.`)
        return 1
      }
      return await verifyOne(context, gate)
    }
    case 'precommit': {
      return precommit(context)
    }
    case 'commit-message': {
      return commitMessage(context, rest[0], rest[1])
    }
    default: {
      console.error(`unknown command "${command}"\n\n${USAGE}`)
      return 1
    }
  }
}

process.exitCode = await main()
