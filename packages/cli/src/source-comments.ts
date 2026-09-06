import type { SourceComment } from '@ploaness/governance'
import ts from 'typescript'

const LITERAL_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.JsxText,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
])

const literalRangesOf = (node: ts.Node, source: ts.SourceFile): readonly ts.TextRange[] => [
  ...(LITERAL_KINDS.has(node.kind)
    ? [
        {
          pos: node.kind === ts.SyntaxKind.JsxText ? node.pos : node.getStart(source),
          end: node.end,
        },
      ]
    : []),
  ...node
    .getChildren(source)
    .flatMap((child: ts.Node): readonly ts.TextRange[] => literalRangesOf(child, source)),
]

const rangesOf = (node: ts.Node, source: ts.SourceFile): readonly ts.CommentRange[] => [
  ...(node.kind === ts.SyntaxKind.JsxText
    ? []
    : (ts.getLeadingCommentRanges(source.text, node.getFullStart()) ?? [])),
  ...(ts.getTrailingCommentRanges(source.text, node.end) ?? []),
  ...node
    .getChildren(source)
    .flatMap((child: ts.Node): readonly ts.CommentRange[] => rangesOf(child, source)),
]

/**
 * Read actual source comments without mistaking strings, regular expressions, or JSX text for directives.
 * @param text the source being checked.
 * @param file the filename, which determines whether angle brackets are types or JSX.
 * @returns comments once each, located at their original source lines.
 */
export const sourceComments = (
  text: string,
  file: string = 'source.tsx',
): readonly SourceComment[] => {
  const source: ts.SourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const ranges: ReadonlyMap<number, ts.CommentRange> = new Map(
    rangesOf(source, source).map((range: ts.CommentRange): readonly [number, ts.CommentRange] => [
      range.pos,
      range,
    ]),
  )
  const literals: readonly ts.TextRange[] = literalRangesOf(source, source)
  return [...ranges.values()]
    .filter(
      (range: ts.CommentRange): boolean =>
        !literals.some(
          (literal: ts.TextRange): boolean => range.pos >= literal.pos && range.pos < literal.end,
        ),
    )
    .toSorted((left: ts.CommentRange, right: ts.CommentRange): number => left.pos - right.pos)
    .map(
      (range: ts.CommentRange): SourceComment => ({
        line: source.getLineAndCharacterOfPosition(range.pos).line + 1,
        text: text.slice(range.pos, range.end),
      }),
    )
}
