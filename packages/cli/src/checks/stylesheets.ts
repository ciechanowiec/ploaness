import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { prettierExecutable } from '@ploaness/config/formatting'
import { hasExtension, matchesAnyGlob, memberFiles, STYLESHEET_EXTENSIONS } from '@ploaness/governance'
import { type Member, presentWorkingTreeFiles, resolveTool, shippedDirectory } from '../context.js'
import { failed, fromRun, type GateResult, passed, type RunResult, runNode } from '../exec.js'

const stylesheetFiles = (context: Member): readonly string[] =>
  memberFiles(presentWorkingTreeFiles(context.root), context.siblingPaths).filter(
    (file: string): boolean =>
      hasExtension(file, STYLESHEET_EXTENSIONS) &&
      context.settings.sourceRoots.some((root: string): boolean => root === '.' || file.startsWith(`${root}/`)) &&
      !matchesAnyGlob(file, context.settings.generatedArtefacts),
  )

const formatScss = (context: Member, file: string): RunResult =>
  runNode(
    prettierExecutable(),
    [
      '--parser',
      'scss',
      '--config',
      path.join(shippedDirectory('@ploaness/config'), 'prettier-scss.json'),
      '--no-editorconfig',
    ],
    { cwd: context.root, input: readFileSync(path.join(context.root, file), 'utf8') },
  )

const scssFindings = (context: Member, files: readonly string[]): readonly string[] =>
  files
    .filter((file: string): boolean => file.endsWith('.scss'))
    .flatMap((file: string): readonly string[] => {
      const formatted: RunResult = formatScss(context, file)
      if (formatted.code !== 0) {
        return [`${file}: SCSS formatting failed: ${formatted.output}`]
      }
      return formatted.stdout === readFileSync(path.join(context.root, file), 'utf8')
        ? []
        : [`${file}: SCSS formatting differs; run ploaness format`]
    })

/** Judge every owned stylesheet with the dialect-specific parser and SCSS formatter. */
export const css = (context: Member): GateResult => {
  const files: readonly string[] = stylesheetFiles(context)
  if (files.length === 0) {
    return passed('this member has no authored stylesheets')
  }
  const stylesheetConfig: string = path.join(shippedDirectory('@ploaness/config'), 'stylelint.json')
  const executable: string = resolveTool('stylelint')
  const lint: GateResult = fromRun(
    runNode(executable, ['--config', stylesheetConfig, ...files, '--max-warnings=0'], { cwd: context.root }),
    'style sheets pass Stylelint',
    'a style sheet does not pass Stylelint',
  )
  if (!lint.ok) {
    return lint
  }
  const findings: readonly string[] = scssFindings(context, files)
  return findings.length === 0
    ? passed('stylesheets pass lint and formatting')
    : failed('SCSS formatting differs', findings)
}

/** Format the same SCSS files the stylesheet gate judges, without consulting consumer options. */
export const scssWrite = (context: Member): RunResult => {
  const results: readonly RunResult[] = stylesheetFiles(context)
    .filter((file: string): boolean => file.endsWith('.scss'))
    .map((file: string): RunResult => {
      const result: RunResult = formatScss(context, file)
      if (result.code === 0) {
        writeFileSync(path.join(context.root, file), result.stdout)
      }
      return result
    })
  return {
    code: results.some((result: RunResult): boolean => result.code !== 0) ? 1 : 0,
    output: results
      .filter((result: RunResult): boolean => result.code !== 0)
      .map((result: RunResult): string => result.output)
      .join('\n'),
    stdout: '',
  }
}
