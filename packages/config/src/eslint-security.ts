// Security-sensitive values at the two output boundaries static syntax can identify reliably.
//
// These selectors deliberately stop at an explicit function call. `redact(user.token)` and
// `publicError(error)` are reviewable sanitisation boundaries; reaching through them would turn a rule
// about raw values into a guess about a function's semantics. Direct identifiers, member reads,
// templates, binary expressions, and shorthand objects have no such boundary and are rejected.
/** One `no-restricted-syntax` entry: the shape to reject, and what to say when it appears. */
export interface RestrictedSyntax {
  readonly selector: string
  readonly message: string
}

const SENSITIVE_NAME: string = '/^(?:password|token|secret|apiKey|privateKey|creditCard|ssn|cvv)$/'

const CONSOLE_CALL: string =
  "CallExpression[callee.type='MemberExpression']" +
  "[callee.object.name='console']" +
  '[callee.property.name=/^(?:log|error|warn|info|debug|trace)$/]'

const SENSITIVE_LOG_MESSAGE: string =
  '[sensitive-data-logged] Do not write a credential-bearing value directly to console output; ' +
  'remove it or pass an explicitly redacted value.'

const sensitiveLog = (suffix: string): RestrictedSyntax => ({
  selector: `${CONSOLE_CALL}${suffix}`,
  message: SENSITIVE_LOG_MESSAGE,
})

const SENSITIVE_LOGGING: readonly RestrictedSyntax[] = [
  sensitiveLog(` > Identifier[name=${SENSITIVE_NAME}]`),
  sensitiveLog(` > MemberExpression[property.name=${SENSITIVE_NAME}]`),
  sensitiveLog(` > ChainExpression MemberExpression[property.name=${SENSITIVE_NAME}]`),
  sensitiveLog(` > TemplateLiteral Identifier[name=${SENSITIVE_NAME}]`),
  sensitiveLog(` > TemplateLiteral MemberExpression[property.name=${SENSITIVE_NAME}]`),
  sensitiveLog(` > BinaryExpression Identifier[name=${SENSITIVE_NAME}]`),
  sensitiveLog(` > BinaryExpression MemberExpression[property.name=${SENSITIVE_NAME}]`),
  sensitiveLog(` > ObjectExpression Property[shorthand=true] > Identifier[name=${SENSITIVE_NAME}]`),
  sensitiveLog(` > ObjectExpression Property > MemberExpression[property.name=${SENSITIVE_NAME}]`),
]

const INTERNAL_ERROR: string =
  'MemberExpression[object.name=/^(?:err|error|exception)$/]' +
  '[property.name=/^(?:message|stack)$/]'

const ERROR_PROPERTY: string =
  'Property[key.name=/^(?:error|message)$/], Property[key.value=/^(?:error|message)$/]'

const JSON_RESPONSE: string =
  "CallExpression[callee.type='MemberExpression']" +
  '[callee.object.name=/^(?:Response|NextResponse)$/]' +
  "[callee.property.name='json']"

const ERROR_RESPONSE_MESSAGE: string =
  '[leaks-error-message] Do not return an internal error message or stack to a caller; log it ' +
  'server-side and return a generic or explicitly sanitised public error.'

const errorResponse = (selector: string): RestrictedSyntax => ({
  selector,
  message: ERROR_RESPONSE_MESSAGE,
})

const INTERNAL_ERROR_RESPONSES: readonly RestrictedSyntax[] = [
  errorResponse(
    `${JSON_RESPONSE} > ObjectExpression > :matches(${ERROR_PROPERTY}) > ${INTERNAL_ERROR}`,
  ),
  errorResponse(`${JSON_RESPONSE} > ${INTERNAL_ERROR}`),
  errorResponse(
    `ReturnStatement > ObjectExpression > :matches(${ERROR_PROPERTY}) > ${INTERNAL_ERROR}`,
  ),
  errorResponse(
    `ArrowFunctionExpression[expression=true] > ObjectExpression > ` +
      `:matches(${ERROR_PROPERTY}) > ${INTERNAL_ERROR}`,
  ),
  errorResponse(`NewExpression[callee.name='Response'] > ${INTERNAL_ERROR}`),
]

/** Output-boundary syntax every composed configuration must retain. */
export const SECURITY_RESTRICTIONS: readonly RestrictedSyntax[] = [
  ...SENSITIVE_LOGGING,
  ...INTERNAL_ERROR_RESPONSES,
]
