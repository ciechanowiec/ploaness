import { meta, type ParserOptions, parseForESLint } from '@typescript-eslint/parser'
import ts from 'typescript'

/** Provide inferred JavaScript types to mutation checks without requiring consumer tsconfig inclusion. */
export const javaScriptParser = (): Readonly<Record<string, unknown>> => ({
  meta,
  parseForESLint(source: string, options: ParserOptions): ReturnType<typeof parseForESLint> {
    const file: string | undefined = options.filePath
    if (file === undefined) {
      throw new Error('JavaScript lint requires an explicit file path')
    }
    const compilerOptions: ts.CompilerOptions = {
      allowJs: true,
      checkJs: false,
      noEmit: true,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    }
    const host: ts.CompilerHost = ts.createCompilerHost(compilerOptions)
    const program: ts.Program = ts.createProgram([file], compilerOptions, {
      ...host,
      getSourceFile: (name, languageVersion, onError, shouldCreateNewSourceFile): ts.SourceFile | undefined =>
        name === file
          ? ts.createSourceFile(name, source, languageVersion)
          : host.getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile),
    })
    return parseForESLint(source, {
      ...options,
      project: false,
      projectService: false,
      programs: [program],
    })
  },
})
