import { isCommonJsExport } from '@ploaness/governance'
import type { ESLint, Rule, Scope } from 'eslint'
import functional from 'eslint-plugin-functional'

type Assignment = Parameters<NonNullable<Rule.RuleListener['AssignmentExpression']>>[0]

type MemberTarget = Extract<Assignment['left'], { readonly type: 'MemberExpression' }>

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

const TOP_LEVEL_ASSIGNMENT_DEPTH: number = 2

const isExportAssignment = (node: Assignment, context: Rule.RuleContext): boolean => {
  const target: Assignment['left'] = node.left
  if (
    target.type !== 'MemberExpression' ||
    context.sourceCode.getAncestors(node).length !== TOP_LEVEL_ASSIGNMENT_DEPTH
  ) {
    return false
  }
  const object: ExportObject | undefined = exportObject(target)
  if (object === undefined) {
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
