import { describe, expect, it } from 'vitest'
import { isWithinCallArguments, type JavascriptSyntaxNode } from '../src/javascript-syntax.js'

const awaited: JavascriptSyntaxNode = { type: 'AwaitExpression' }

describe('isWithinCallArguments', () => {
  it.each(['CallExpression', 'NewExpression'])('recognizes an argument of %s', (type: string) => {
    expect(isWithinCallArguments(awaited, [{ type, arguments: [awaited] }])).toBe(true)
  })

  it('recognizes nested expressions within an argument', () => {
    const argument: JavascriptSyntaxNode = { type: 'ObjectExpression' }
    expect(
      isWithinCallArguments(awaited, [
        { type: 'CallExpression', arguments: [argument] },
        argument,
        { type: 'Property' },
      ]),
    ).toBe(true)
  })

  it.each(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])(
    'stops at a %s body',
    (type: string) => {
      const callback: JavascriptSyntaxNode = { type }
      expect(
        isWithinCallArguments(awaited, [
          { type: 'CallExpression', arguments: [callback] },
          callback,
          { type: 'ReturnStatement' },
        ]),
      ).toBe(false)
    },
  )

  it('recognizes an inner call before reaching its enclosing function boundary', () => {
    expect(
      isWithinCallArguments(awaited, [
        { type: 'FunctionExpression' },
        { type: 'CallExpression', arguments: [awaited] },
      ]),
    ).toBe(true)
  })

  it('leaves a callee expression outside the arguments', () => {
    expect(isWithinCallArguments(awaited, [{ type: 'CallExpression', arguments: [] }])).toBe(false)
  })

  it('still checks a callee contained in an outer argument', () => {
    const inner: JavascriptSyntaxNode = { type: 'CallExpression', arguments: [] }
    expect(isWithinCallArguments(awaited, [{ type: 'CallExpression', arguments: [inner] }, inner])).toBe(true)
  })

  it('leaves expressions outside calls alone', () => {
    expect(isWithinCallArguments(awaited, [{ type: 'ReturnStatement' }])).toBe(false)
  })

  it('requires an argument containing the expression', () => {
    expect(isWithinCallArguments(awaited, [{ type: 'CallExpression' }])).toBe(false)
  })
})
