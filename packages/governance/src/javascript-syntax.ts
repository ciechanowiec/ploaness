/** The syntax facts needed to distinguish a call's arguments from its callee and nested function bodies. */
export interface JavascriptSyntaxNode {
  readonly type: string
  readonly arguments?: readonly JavascriptSyntaxNode[]
}

const FUNCTION_BOUNDARIES: ReadonlySet<string> = new Set<string>([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
])

/**
 * Whether an expression is evaluated within a call or constructor argument in its own function body.
 * @param node the expression being checked.
 * @param ancestors its ancestors, from the program to its immediate parent.
 * @returns true when an argument contains the expression without crossing a function boundary.
 */
export const isWithinCallArguments = (
  node: JavascriptSyntaxNode,
  ancestors: readonly JavascriptSyntaxNode[],
): boolean => {
  const parent: JavascriptSyntaxNode | undefined = ancestors.at(-1)
  if (parent === undefined || FUNCTION_BOUNDARIES.has(parent.type)) {
    return false
  }
  if (
    (parent.type === 'CallExpression' || parent.type === 'NewExpression') &&
    parent.arguments?.includes(node) === true
  ) {
    return true
  }
  return isWithinCallArguments(parent, ancestors.slice(0, -1))
}
