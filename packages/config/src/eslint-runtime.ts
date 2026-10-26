// What an allowlisted file may use when the engine its entry declares is not Node.js.
//
// A CloudFront Function runs in AWS's `cloudfront-js-2.0` engine: ES 5.1 plus the later features AWS
// lists in "JavaScript runtime 2.0 features for CloudFront Functions". Node.js parses everything that
// engine rejects, so a file declared for it is linted against that list as well, in this block and for
// that file only. Arrow functions, `const`, template literals, rest parameters, `Object.keys`,
// `Object.entries`, `Object.assign` and `Array.prototype.includes` are on the list and stay legal.
//
// The restrictions include known deployment failures and precautionary extensions where AWS provides
// no exact grammar. Passing these rules lowers the risk without proving the file runs. Only executing
// it in CloudFront proves that.
import { CLOUDFRONT_RUNTIME, isWithinCallArguments } from '@ploaness/governance'
import type { Rule } from 'eslint'
import { type FileMatcher, type FlatConfigBlock, NO_INHERITANCE } from './eslint-core.js'
import { type RestrictedSyntax, SECURITY_RESTRICTIONS } from './eslint-security.js'

const unsupported = (construct: string, instead: string): string =>
  `${construct} is not supported by runtime ${CLOUDFRONT_RUNTIME}; ${instead}`

const DESTRUCTURING: string = unsupported(
  'destructuring',
  'read each property or index by name, for example parts[0] and parts.slice(1)',
)

type AwaitExpression = Parameters<NonNullable<Rule.RuleListener['AwaitExpression']>>[0]
const AWAIT_EXPRESSION: string = 'AwaitExpression'

// Direct awaited arguments fail in CloudFront. Nested argument expressions are rejected as a precaution.
// Visit each await once: an outer call must not claim a callback's body, but calls inside it still count.
const NO_AWAIT_IN_ARGUMENTS: Rule.RuleModule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { unsupported: unsupported('await within call arguments', 'await into a constant first') },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      [AWAIT_EXPRESSION](node: AwaitExpression): void {
        if (isWithinCallArguments(node, context.sourceCode.getAncestors(node))) {
          context.report({ node, messageId: 'unsupported' })
        }
      },
    }
  },
}

// AST node types rather than text, so a string or a comment never matches. A pattern is a binding or an
// assignment target, never a literal. A rest parameter is a `RestElement` directly under a function,
// which neither pattern selector reaches, while `[tag, ...rest]` is an `ArrayPattern` and is reported.
// Spread is reported only inside an object literal: AWS lists rest parameters, and array and call spread
// are not restricted here.
const CLOUDFRONT_SYNTAX: readonly RestrictedSyntax[] = [
  { selector: 'ObjectPattern', message: DESTRUCTURING },
  { selector: 'ArrayPattern', message: DESTRUCTURING },
  {
    selector: 'ObjectExpression > SpreadElement',
    message: unsupported('object spread', 'copy with Object.assign({}, source, { key: value })'),
  },
]

interface RestrictedGlobal {
  readonly name: string
  readonly message: string
}

const restrictedGlobal = (name: string, instead: string): RestrictedGlobal => ({
  name,
  message: unsupported(name, instead),
})

// Matched through scope analysis, so a local binding with one of these names is not a use of the global.
// The collections and reflection objects are absent from AWS's list. The process and the timers are
// on its list of restricted features, because a function must run synchronously to completion.
const CLOUDFRONT_GLOBALS: readonly RestrictedGlobal[] = [
  restrictedGlobal('Set', 'use an array and includes'),
  restrictedGlobal('Map', 'use a plain object and Object.keys'),
  restrictedGlobal('WeakSet', 'use an array and includes'),
  restrictedGlobal('WeakMap', 'use a plain object'),
  restrictedGlobal('Proxy', 'read the object directly'),
  restrictedGlobal('Reflect', 'use the Object methods the runtime lists'),
  restrictedGlobal('process', 'the runtime has no process; read configuration from the event or a key value store'),
  restrictedGlobal('setTimeout', 'a function must run synchronously to completion'),
  restrictedGlobal('setImmediate', 'a function must run synchronously to completion'),
  restrictedGlobal('clearTimeout', 'a function must run synchronously to completion'),
]

/**
 * The restrictions of the `cloudfront-js-2.0` runtime, for the files whose allowlist entry declares it.
 *
 * Placed after the general JavaScript block. It restates the shared `no-restricted-syntax` entries, because
 * a block that sets that rule replaces the setting rather than adding to it.
 * @param files the matchers for files declared to run in CloudFront.
 * @returns a flat-config block.
 */
export const cloudFrontBlock = (files: readonly FileMatcher[]): FlatConfigBlock => ({
  files,
  plugins: { cloudfront: { rules: { 'no-await-in-arguments': NO_AWAIT_IN_ARGUMENTS } } },
  rules: {
    'cloudfront/no-await-in-arguments': 'error',
    'no-restricted-syntax': [...NO_INHERITANCE, ...SECURITY_RESTRICTIONS, ...CLOUDFRONT_SYNTAX],
    'no-restricted-globals': ['error', ...CLOUDFRONT_GLOBALS],
    // It demands the `Set` this runtime lacks for every array only searched with `includes`, which is
    // the replacement named above, so no file could satisfy both.
    'unicorn/prefer-set-has': 'off',
  },
})
