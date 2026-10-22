import { isCommonJsExport } from '@ploaness/governance'
import type { ESLint, Rule, Scope } from 'eslint'
import functional from 'eslint-plugin-functional'

type Assignment = Parameters<NonNullable<Rule.RuleListener['AssignmentExpression']>>[0]

type MemberTarget = Extract<Assignment['left'], { readonly type: 'MemberExpression' }>

type Ancestor = ReturnType<Rule.RuleContext['sourceCode']['getAncestors']>[number]

type Guard = Extract<Ancestor, { readonly type: 'IfStatement' }>

type Operand = Extract<Guard['test'], { readonly type: 'BinaryExpression' }>['left']

const propertyName = (target: MemberTarget): string | undefined => {
  if (target.property.type === 'Identifier' && !target.computed) {
    return target.property.name
  }
  return target.property.type === 'Literal' && typeof target.property.value === 'string'
    ? target.property.value
    : undefined
}

const isRuntimeBinding = (scope: Scope.Scope | undefined, name: string): boolean => {
  if (scope === undefined) {
    return true
  }
  const variable: Scope.Variable | undefined = scope.set.get(name)
  return variable === undefined ? isRuntimeBinding(scope.upper ?? undefined, name) : variable.defs.length === 0
}

interface ExportObject {
  readonly name: string
  readonly binding: string
}

const exportObject = (target: MemberTarget): ExportObject | undefined => {
  if (target.object.type === 'Identifier') {
    return { name: target.object.name, binding: target.object.name }
  }
  if (
    target.object.type === 'MemberExpression' &&
    target.object.object.type === 'Identifier' &&
    target.object.object.name === 'module' &&
    propertyName(target.object) === 'exports'
  ) {
    return { name: 'module.exports', binding: 'module' }
  }
  return undefined
}

const UNDEFINED_TYPE: string = 'undefined'

// `typeof module !== 'undefined'`, in either order: the test a file that also runs outside CommonJS, such as
// an edge function a test loads in Node, places around its export.
const isPresenceTest = (test: Guard['test'], binding: string): boolean =>
  test.type === 'BinaryExpression' &&
  (test.operator === '!==' || test.operator === '!=') &&
  [
    [test.left, test.right],
    [test.right, test.left],
  ].some(
    ([operand, literal]: readonly Operand[]): boolean =>
      operand?.type === 'UnaryExpression' &&
      operand.operator === 'typeof' &&
      operand.argument.type === 'Identifier' &&
      operand.argument.name === binding &&
      literal?.type === 'Literal' &&
      literal.value === UNDEFINED_TYPE,
  )

const isGuardOf = (guard: Ancestor, consequent: Ancestor, binding: string): boolean =>
  guard.type === 'IfStatement' && guard.consequent === consequent && isPresenceTest(guard.test, binding)

// The node an export statement initializes the module from: the statement itself, or the block holding it.
const consequentOf = (ancestors: readonly Ancestor[]): Ancestor | undefined => {
  const [statement, block]: readonly Ancestor[] = ancestors.toReversed()
  if (statement?.type !== 'ExpressionStatement') {
    return undefined
  }
  return block?.type === 'BlockStatement' ? block : statement
}

// Module initialization is a statement of the program, or the consequent, alone or in a block, of a presence
// test of the export's binding that is one.
const isInitialization = (ancestors: readonly Ancestor[], binding: string): boolean => {
  const consequent: Ancestor | undefined = consequentOf(ancestors)
  if (consequent === undefined) {
    return false
  }
  const [program, guard, ...deeper]: readonly Ancestor[] = ancestors.slice(0, ancestors.lastIndexOf(consequent))
  return (
    program?.type === 'Program' &&
    deeper.length === 0 &&
    (guard === undefined ? consequent === ancestors.at(-1) : isGuardOf(guard, consequent, binding))
  )
}

const isExportAssignment = (node: Assignment, context: Rule.RuleContext): boolean => {
  const target: Assignment['left'] = node.left
  if (target.type !== 'MemberExpression') {
    return false
  }
  const object: ExportObject | undefined = exportObject(target)
  if (object === undefined || !isInitialization(context.sourceCode.getAncestors(node), object.binding)) {
    return false
  }
  return isCommonJsExport(
    node.operator,
    object.name,
    propertyName(target),
    isRuntimeBinding(context.sourceCode.getScope(node), object.binding),
  )
}
const ASSIGNMENT_EXPRESSION: string = 'AssignmentExpression'

const immutableData: Rule.RuleModule = functional.rules['immutable-data']

// An accessor exemption also exempts calls such as module.exports.push(). Filter only the export
// assignment visitor, leaving every other mutation visitor and every ordinary assignment intact.
const commonJsAware: Rule.RuleModule = {
  ...immutableData,
  create(context: Rule.RuleContext): Rule.RuleListener {
    const listeners: Rule.RuleListener = immutableData.create(context)
    return {
      ...listeners,
      [ASSIGNMENT_EXPRESSION]: (node: Assignment): void => {
        if (!(context.filename.endsWith('.cjs') && isExportAssignment(node, context))) {
          listeners.AssignmentExpression?.(node)
        }
      },
    }
  },
}

/** The upstream mutation rules with a narrow CommonJS module-interface initialization allowance. */
export const immutabilityPlugin: ESLint.Plugin = {
  ...functional,
  rules: { ...functional.rules, 'immutable-data': commonJsAware },
}
