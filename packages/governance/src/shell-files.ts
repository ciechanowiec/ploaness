// Which tracked files are shell scripts, and which suppressions inside them are blanket ones.
//
// Extension AND shebang. `scripts/deploy.sh` announces itself, but `hooks/pre-commit` and `bin/release`
// are shell too and carry no extension, so an extension-only rule would leave exactly the operational
// scripts unread. Reading the first line of every tracked file would be a sweep of the whole tree, so
// the read is bounded to the paths whose extension could not already have answered. The reader is
// injected rather than imported, which is what keeps this layer free of the filesystem.

/** The extensions ShellCheck recognises as naming a dialect it reads. */
export const SHELL_EXTENSIONS: readonly string[] = ['.sh', '.bash', '.ksh', '.dash', '.bats']

// The interpreters ShellCheck can analyse. zsh and fish are deliberately absent: ShellCheck refuses a
// zsh script with SC1071 and exits non-zero, so treating one as in scope would manufacture a finding
// about a file written in a dialect it never claimed to read.
const SHELL_INTERPRETERS: ReadonlySet<string> = new Set(['sh', 'bash', 'ksh', 'dash', 'bats'])

const SHEBANG: RegExp = /^#!\s*(?<command>\S+)(?:[ \t]+(?<argument>\S+))?/
const ENV_COMMAND: string = '/env'

const basenameOf = (file: string): string => file.slice(file.lastIndexOf('/') + 1)

/**
 * Whether a first line names an interpreter ShellCheck reads.
 * @param firstLine the file's first line.
 * @returns true for a shell shebang, false for any other interpreter and for no shebang at all.
 */
export const isShellShebang = (firstLine: string): boolean => {
  const found: RegExpExecArray | null = SHEBANG.exec(firstLine)
  if (found === null) {
    return false
  }
  const command: string = found.groups?.['command'] ?? ''
  // `#!/usr/bin/env bash` names the interpreter in the argument; everything else names it in the path.
  const interpreter: string = command.endsWith(ENV_COMMAND)
    ? (found.groups?.['argument'] ?? '')
    : basenameOf(command)
  return SHELL_INTERPRETERS.has(interpreter)
}

/**
 * Whether a path's extension names a shell dialect.
 * @param file the repo-relative path.
 * @returns true when the extension is one ShellCheck reads.
 */
export const isShellScript = (file: string): boolean =>
  SHELL_EXTENSIONS.some((extension: string): boolean => file.endsWith(extension))

/**
 * Whether a path's first line is worth reading to classify it.
 *
 * Only an extensionless basename: anything carrying a dot has already been answered by its extension,
 * and reading it would be an I/O cost with no question behind it.
 * @param file the repo-relative path.
 * @returns true when only the shebang can decide.
 */
export const requiresShebangRead = (file: string): boolean => !basenameOf(file).includes('.')

/**
 * Every shell script the repository tracks.
 *
 * A shebang DECIDES where one is present, so a `.sh` file written for zsh leaves scope rather than
 * being sent to an analyzer that refuses it. Where none is present the extension stands.
 * @param tracked the repo-relative paths of the tracked files.
 * @param firstLineOf reads one file's first line; called only for paths that could be shell.
 * @returns the scripts, ordered so a report reads the same on every machine.
 */
export const shellScriptsIn = (
  tracked: readonly string[],
  firstLineOf: (file: string) => string,
): readonly string[] =>
  tracked
    .filter((file: string): boolean => isShellScript(file) || requiresShebangRead(file))
    .filter((file: string): boolean => {
      const first: string = firstLineOf(file)
      return first.startsWith('#!') ? isShellShebang(first) : isShellScript(file)
    })
    .toSorted((left: string, right: string): number => left.localeCompare(right))

/** One blanket suppression: the line it sits on, and what it disables. */
export interface ShellDirective {
  readonly line: number
  readonly directive: string
}

// A directive that names its codes is the legitimate form, and ShellCheck offers no flag to refuse one.
// What is refused here is the in-file equivalent of an rc file: `disable=all`, and a range wide enough
// to mean the same thing. `--norc` removes the project-wide spelling; this removes the per-file one.
const DISABLE_DIRECTIVE: RegExp = /#[ \t]*shellcheck[ \t]+disable=(?<codes>\S+)/
const BLANKET_CODES: RegExp = /^(?:all|SC\d+-SC\d+)$/

const FIRST_LINE: number = 1

// A heredoc body is data rather than script. A script that WRITES another script carries that script's
// directives inside it, and reading them as its own reports a repository for the contents of a file it
// generates. ShellCheck itself draws this line, so a rule that supplements it must draw it too - the
// same reason `stripComments` exists for source: prose naming a construct is not that construct.
const HEREDOC_OPEN: RegExp = /<<-?[ \t]*(?<quote>['"]?)(?<delimiter>[a-z_]\w*)\k<quote>/i

/** Where the scan stands: the heredoc delimiter still open, and what has been found so far. */
interface DirectiveScan {
  readonly delimiter: string | undefined
  readonly found: readonly ShellDirective[]
}

// `<<-` strips leading tabs from the terminator, which trimming covers without the scan needing to know
// which of the two forms opened the body.
const endsHeredoc = (line: string, delimiter: string): boolean => line.trim() === delimiter

const blanketDirectiveAt = (line: string, index: number): ShellDirective | undefined => {
  const codes: string | undefined = DISABLE_DIRECTIVE.exec(line)?.groups?.['codes']
  return codes !== undefined && BLANKET_CODES.test(codes)
    ? { line: index + FIRST_LINE, directive: codes }
    : undefined
}

const afterLine = (state: DirectiveScan, line: string, index: number): DirectiveScan => {
  // Inside a heredoc nothing is read but its terminator.
  if (state.delimiter !== undefined) {
    return endsHeredoc(line, state.delimiter) ? { ...state, delimiter: undefined } : state
  }
  const opened: string | undefined = HEREDOC_OPEN.exec(line)?.groups?.['delimiter']
  if (opened !== undefined) {
    return { ...state, delimiter: opened }
  }
  const directive: ShellDirective | undefined = blanketDirectiveAt(line, index)
  return directive === undefined ? state : { ...state, found: [...state.found, directive] }
}

/**
 * Report every blanket ShellCheck suppression a script applies to itself.
 * @param text the script's contents.
 * @returns one entry per blanket directive, in the order they appear.
 */
export const findBlanketShellDirectives = (text: string): readonly ShellDirective[] =>
  text
    .split('\n')
    .reduce<DirectiveScan>(
      (state: DirectiveScan, line: string, index: number): DirectiveScan =>
        afterLine(state, line, index),
      { delimiter: undefined, found: [] },
    ).found
