// The token-bound rule: every colour, size, spacing, radius and motion value a Tailwind project
// renders must come from the theme, applied through a utility class.
//
// An arbitrary value - `bg-[#0a7]`, `p-[13px]`, `translate-y-[2px]` - hardcodes the number instead.
// Nothing downstream can see that it happened: the page renders, the build passes, and the design
// system quietly stops being the single source of the value. That is the defect this rule names, and
// it is a rule about Tailwind rather than about any one project, which is why it is here rather than
// in a script a project owns and can edit.
//
// The match is deliberately narrow, because the two things it must not confuse look alike:
//
//   - An arbitrary VALUE is `<utility>-[<value>]` and IS a finding. The `-` before the bracket is what
//     separates it from TypeScript index access (`medalChip[result.medal]`), which has no dash.
//   - An arbitrary VARIANT is `data-[state=open]:...` or `[&>tr]:...` and is NOT. A variant is a
//     selector prefix rather than a value, and is always followed by `:`. The negative lookahead below
//     is what keeps it out - and is the reason this is a rule in TypeScript rather than a GritQL
//     plugin, whose Rust regex engine has no lookahead to express it with.

/** One arbitrary-Tailwind-value occurrence: where it is, and the token that caused it. */
export interface ArbitraryValueViolation {
  /** 1-based line. */
  readonly line: number
  /** 1-based column. */
  readonly column: number
  /** The offending token, as written. */
  readonly value: string
}

// A utility with a bracketed value, not immediately followed by `:` (which would make it a variant).
const ARBITRARY_VALUE: RegExp = /-\[[^\]]+\](?!:)/g

// Utilities whose bracket takes something OTHER than a themeable value.
//
// `transition-[color,box-shadow]` names which properties animate and `will-change-[margin-top]` names
// which one is about to. `flex-[1_0_auto]` is the CSS `flex` shorthand - a grow/shrink/basis triple
// describing how a box behaves, not a colour, size, spacing, radius or motion value. Tailwind v4 has
// namespaces for every kind of value this rule governs and none for any of these, so reporting them
// asked for a token that cannot exist, and the only way out was a suppression: a real allowance spent
// on a false finding.
//
// `flex-[1]` is NOT excused by this. It is still reported, because Tailwind ships `flex-1` for it - the
// finding there is an arbitrary value written where a utility already exists, which is the defect.
// Only the shorthand form, which no utility and no token can express, is out of scope.
const PROPERTY_UTILITIES: readonly string[] = ['transition', 'will-change']

// The `flex` shorthand, told apart from `flex-[1]` by carrying more than one component. Written as a
// separate test rather than as another entry above, because `flex` is not a property utility: the
// bracket holds values, there is simply no namespace any of them could come from.
const FLEX_SHORTHAND: RegExp = /^-\[[^\s\]_]*[\s_][^\]]*\]$/

const carriesFlexShorthand = (lineText: string, index: number, value: string): boolean =>
  lineText.slice(0, index).endsWith('flex') && FLEX_SHORTHAND.test(value)

const carriesProperty = (lineText: string, index: number): boolean =>
  PROPERTY_UTILITIES.some((utility: string): boolean => lineText.slice(0, index).endsWith(utility))

// A bracketed value that COMPUTES rather than states one is the opposite of a hardcoded value.
//
// `var(--x)` is how a value computed at render - a width from a prop, a gap from a CMS field - reaches a
// utility class, and a static theme cannot hold a per-instance value.
//
// A calculation is judged by what it computes OVER, which is where this rule previously drew the line in
// the wrong place. `calc(100px_+_2rem)` is arithmetic on two lengths that both belong in the theme, and
// is still a finding. `calc(100%_-_1px)` is not: a percentage resolves against whatever contains the
// element, so the number it produces is not knowable where a token would have to be written - the same
// reason `var(--x)` is excused, reached by a different route. The same holds for a viewport unit.
const CUSTOM_PROPERTY: RegExp = /var\(\s*--/

// A length that only means something once the element has a container or a viewport.
const CONTEXT_RELATIVE: RegExp = /\d(?:%|v(?:w|h|min|max)\b)/

const carriesComputedValue = (value: string): boolean =>
  CUSTOM_PROPERTY.test(value) || (value.includes('calc(') && CONTEXT_RELATIVE.test(value))

/**
 * Find every arbitrary Tailwind value in one file's text.
 * @param content the file's text.
 * @returns the violations, each with a 1-based line and column and the offending token.
 */
export const findArbitraryValues = (content: string): readonly ArbitraryValueViolation[] => {
  const lines: readonly string[] = content.split('\n')
  return lines.flatMap((lineText: string, index: number): readonly ArbitraryValueViolation[] =>
    [...lineText.matchAll(ARBITRARY_VALUE)]
      .filter(
        (match: RegExpExecArray): boolean =>
          !(
            carriesProperty(lineText, match.index) ||
            carriesComputedValue(match[0]) ||
            carriesFlexShorthand(lineText, match.index, match[0])
          ),
      )
      .map(
        (match: RegExpExecArray): ArbitraryValueViolation => ({
          line: index + 1,
          column: match.index + 1,
          value: match[0],
        }),
      ),
  )
}
