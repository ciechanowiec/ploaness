// What to do with the axe bucket the shipped sweep used to discard.
//
// axe returns three buckets, not two: `violations`, `passes`, and `incomplete` - the last meaning "a
// check ran and could not decide". The accessibility sweep asserted `violations` alone, which reads as
// the obvious thing to write and silently excluded the single worst defect the sweep exists to catch.
//
// An exactly equal foreground and background is filed as incomplete rather than as a violation,
// because axe reads identical colours as text hidden on purpose and refers the question to a human.
// So a control drawn in its own background colour - contrast ratio 1:1, invisible to every reader -
// passed a gate built to measure contrast. A project confirmed it by mutation: removing the colour fix
// from the page left the assertion green.
//
// The answer is narrow on purpose. A blanket "incomplete must be empty" would be wrong for a rule no
// project can edit: text over a photograph, a gradient, or a partly transparent layer lands in this
// bucket legitimately, and axe defers there because the question genuinely needs a human. `equalRatio`
// is the one key that needs none - two identical colours cannot be a judgement call - so it is the one
// key that fails. The list is a floor to widen when another key turns out to be as unambiguous, not a
// ceiling.
import { asRecord, asText, isArray } from './json-shapes.js'

/**
 * The axe `incomplete` message keys that describe a defect rather than a question.
 *
 * Exported so a project reading a finding can see the whole of what is enforced, and so a spec can
 * assert the enforced set rather than a single member of it.
 */
export const DEFINITE_INCOMPLETE_KEYS: readonly string[] = ['equalRatio']

// A node's checks live under three keys, and which one carries the result depends on how the rule was
// composed rather than on anything the reader chose. Reading only `any` would miss a rule expressed as
// `all`, which is a silence of exactly the kind this module exists to remove.
const CHECK_KEYS: readonly string[] = ['any', 'all', 'none']

// A node names itself by CSS selector, and axe nests the selector when the node is inside an iframe.
// Joining rather than taking the first keeps a finding pointing at the element a reader has to open.
const TARGET_SEPARATOR: string = ' >>> '

const targetOf = (node: unknown): string => {
  const target: unknown = asRecord(node)['target']
  if (!isArray(target)) {
    return '(unknown element)'
  }
  const parts: readonly string[] = target.map((part: unknown): string => asText(part))
  return parts.length === 0 ? '(unknown element)' : parts.join(TARGET_SEPARATOR)
}

const checksOf = (node: unknown): readonly unknown[] =>
  CHECK_KEYS.flatMap((key: string): readonly unknown[] => {
    const checks: unknown = asRecord(node)[key]
    return isArray(checks) ? checks : []
  })

// The message axe itself wrote, rather than one restated here. A locale-aware runner returns the
// translated sentence, and a finding that quoted an English copy would disagree with the report the
// same run printed.
const describeCheck = (ruleId: string, node: unknown, check: unknown): string => {
  const message: string = asText(asRecord(check)['message'])
  const stated: string = message.length > 0 ? message : 'axe reported no message'
  return `${ruleId} on ${targetOf(node)}: ${stated}`
}

// axe names the reason it could not decide under `data.messageKey`, which is the only field here that
// is a stable identifier rather than prose: the message beside it is localised.
const messageKeyOf = (check: unknown): string => {
  const data: Record<string, unknown> = asRecord(asRecord(check)['data'])
  return asText(data['messageKey'])
}

const definiteChecks = (ruleId: string, node: unknown): readonly string[] =>
  checksOf(node)
    .filter((check: unknown): boolean => DEFINITE_INCOMPLETE_KEYS.includes(messageKeyOf(check)))
    .map((check: unknown): string => describeCheck(ruleId, node, check))

const definiteNodes = (result: unknown): readonly string[] => {
  const nodes: unknown = asRecord(result)['nodes']
  const ruleId: string = asText(asRecord(result)['id'])
  return isArray(nodes)
    ? nodes.flatMap((node: unknown): readonly string[] => definiteChecks(ruleId, node))
    : []
}

/**
 * Pick the entries of an axe `incomplete` bucket that are defects rather than open questions.
 *
 * Takes `unknown` rather than axe's own result type because this package declares no dependencies and
 * must not acquire one to read a shape it only ever inspects. The caller passes `scan.incomplete`
 * straight through.
 * @param incomplete the `incomplete` array of an axe result.
 * @returns one human-readable finding per definite defect, in the order axe reported them.
 */
export const findDefiniteIncomplete = (incomplete: unknown): readonly string[] =>
  isArray(incomplete)
    ? incomplete.flatMap((result: unknown): readonly string[] => definiteNodes(result))
    : []
