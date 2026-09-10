import { describe, expect, it } from 'vitest'
import {
  findBlanketShellDirectives,
  isShellScript,
  isShellShebang,
  requiresShebangRead,
  type ShellDirective,
  shellScriptsIn,
} from '../src/shell-files.js'

// The reader a repository would supply, as a lookup: the core takes it as a parameter so this layer
// needs no filesystem and no test double (see AGENTS.md "no mocks").
const firstLines =
  (lines: Readonly<Record<string, string>>) =>
  (file: string): string =>
    lines[file] ?? ''

describe('isShellShebang', () => {
  it.each(['#!/bin/sh', '#!/bin/bash', '#!/usr/bin/env bash', '#!/usr/bin/env sh'])(
    'accepts %s',
    (shebang: string) => {
      expect(isShellShebang(shebang)).toBe(true)
    },
  )

  // ShellCheck refuses zsh with SC1071 and exits non-zero, so a zsh script must never be sent to it.
  it.each(['#!/usr/bin/env zsh', '#!/bin/zsh', '#!/usr/bin/env fish'])(
    'refuses %s, which ShellCheck does not read',
    (shebang: string) => {
      expect(isShellShebang(shebang)).toBe(false)
    },
  )

  it.each(['#!/usr/bin/env python3', '#!/usr/bin/env node'])(
    'refuses %s, which is not a shell at all',
    (shebang: string) => {
      expect(isShellShebang(shebang)).toBe(false)
    },
  )

  it('refuses a line that is not a shebang', () => {
    expect(isShellShebang('echo hello')).toBe(false)
  })
})

describe('isShellScript', () => {
  it.each(['scripts/deploy.sh', 'lib/helpers.bash', 'test/case.bats'])(
    'accepts %s by its extension',
    (file: string) => {
      expect(isShellScript(file)).toBe(true)
    },
  )

  it('does not accept a TypeScript module', () => {
    expect(isShellScript('src/index.ts')).toBe(false)
  })
})

describe('requiresShebangRead', () => {
  // Only an extensionless basename: anything with a dot was already answered by its extension.
  it('asks for the first line of an extensionless path', () => {
    expect(requiresShebangRead('hooks/pre-commit')).toBe(true)
  })

  it('does not ask for the first line of a path that carries an extension', () => {
    expect(requiresShebangRead('src/index.ts')).toBe(false)
  })

  it('reads a dot in the basename rather than in the directory', () => {
    expect(requiresShebangRead('.github/hooks/pre-push')).toBe(true)
  })
})

describe('shellScriptsIn', () => {
  it('finds a script by its extension', () => {
    const tracked: readonly string[] = ['scripts/deploy.sh', 'src/index.ts']
    expect(shellScriptsIn(tracked, firstLines({}))).toEqual(['scripts/deploy.sh'])
  })

  // The operational scripts an extension-only rule would miss entirely.
  it('finds an extensionless script by its shebang', () => {
    const tracked: readonly string[] = ['hooks/pre-commit']
    const lines: (file: string) => string = firstLines({ 'hooks/pre-commit': '#!/bin/sh' })
    expect(shellScriptsIn(tracked, lines)).toEqual(['hooks/pre-commit'])
  })

  // The shebang decides where present, so a file named for one dialect and written in another is
  // classified by what it actually is.
  it('leaves a .sh file written for zsh out of scope', () => {
    const tracked: readonly string[] = ['scripts/prompt.sh']
    const lines: (file: string) => string = firstLines({
      'scripts/prompt.sh': '#!/usr/bin/env zsh',
    })
    expect(shellScriptsIn(tracked, lines)).toEqual([])
  })

  it('keeps a .sh file that carries no shebang at all', () => {
    expect(shellScriptsIn(['scripts/lib.sh'], firstLines({}))).toEqual(['scripts/lib.sh'])
  })

  it('ignores an extensionless file that is not shell', () => {
    const tracked: readonly string[] = ['LICENSE', 'bin/tool']
    const lines: (file: string) => string = firstLines({ 'bin/tool': '#!/usr/bin/env python3' })
    expect(shellScriptsIn(tracked, lines)).toEqual([])
  })

  it('orders the report so it reads the same on every machine', () => {
    const tracked: readonly string[] = ['scripts/b.sh', 'scripts/a.sh']
    expect(shellScriptsIn(tracked, firstLines({}))).toEqual(['scripts/a.sh', 'scripts/b.sh'])
  })

  it('finds nothing in a repository that ships no script', () => {
    expect(shellScriptsIn(['src/index.ts', 'README.md'], firstLines({}))).toEqual([])
  })
})

describe('findBlanketShellDirectives', () => {
  it('reports a directive that disables everything', () => {
    const found: readonly ShellDirective[] = findBlanketShellDirectives(
      ['#!/bin/sh', '# shellcheck disable=all', 'echo "$@"'].join('\n'),
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.line).toBe(2)
    expect(found[0]?.directive).toBe('all')
  })

  it('reports a range wide enough to mean the same thing', () => {
    const found: readonly ShellDirective[] = findBlanketShellDirectives(
      '# shellcheck disable=SC1000-SC9999',
    )
    expect(found[0]?.directive).toBe('SC1000-SC9999')
  })

  // The legitimate form, which ShellCheck offers no flag to refuse and this rule must not either.
  it('accepts a directive that names the code it suppresses', () => {
    expect(findBlanketShellDirectives('# shellcheck disable=SC2086')).toEqual([])
  })

  it('accepts a script that suppresses nothing', () => {
    expect(findBlanketShellDirectives('#!/bin/sh\necho hello')).toEqual([])
  })

  // A script that WRITES another script carries that script's directives inside it. Reading them as its
  // own reports a repository for the contents of a file it generates, which is what this rule did to
  // the fixture suite that exercises it.
  it('ignores a directive inside a quoted heredoc, which is the written script own', () => {
    const text: string = [
      '#!/bin/sh',
      "cat > fixture.sh <<'FIXTURE'",
      '# shellcheck disable=all',
      'FIXTURE',
    ].join('\n')
    expect(findBlanketShellDirectives(text)).toEqual([])
  })

  it('ignores a directive inside an unquoted heredoc', () => {
    const text: string = ['cat > fixture.sh <<FIXTURE', '# shellcheck disable=all', 'FIXTURE'].join(
      '\n',
    )
    expect(findBlanketShellDirectives(text)).toEqual([])
  })

  it('ignores a directive inside a tab-stripped heredoc', () => {
    const text: string = ['cat > f.sh <<-FIXTURE', '# shellcheck disable=all', '\tFIXTURE'].join(
      '\n',
    )
    expect(findBlanketShellDirectives(text)).toEqual([])
  })

  // The terminator closes the body, so the rule has to start reading again rather than give up.
  it('reports a directive the script applies to itself after a heredoc closes', () => {
    const text: string = [
      "cat > fixture.sh <<'FIXTURE'",
      'echo written',
      'FIXTURE',
      '# shellcheck disable=all',
    ].join('\n')
    const found: readonly ShellDirective[] = findBlanketShellDirectives(text)
    expect(found).toHaveLength(1)
    expect(found[0]?.line).toBe(4)
  })
})
