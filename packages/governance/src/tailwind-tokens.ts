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

// Utilities whose bracket takes a CSS PROPERTY rather than a value. `transition-[color,box-shadow]`
// names which properties animate and `will-change-[margin-top]` names which one is about to; neither is
// a colour, size, spacing, radius or motion value, which is what this rule exists to keep in the theme.
// There is no theme namespace they could come from, so reporting them asked for a token that cannot
// exist - and the only way out was a suppression, spending a real allowance on a false finding.
const PROPERTY_UTILITIES: readonly string[] = ['transition', 'will-change']

const carriesProperty = (lineText: string, index: number): boolean =>
  PROPERTY_UTILITIES.some((utility: string): boolean => lineText.slice(0, index).endsWith(utility))

// A bracketed value that reads a CSS custom property is the OPPOSITE of a hardcoded one. It is how a
// value computed at render - a width from a prop, a gap from a CMS field - reaches a utility class, and
// a static theme cannot hold a per-instance value. Reporting it demanded a token for something whose
// whole purpose is not being known until the component renders.
const CUSTOM_PROPERTY: RegExp = /var\(\s*--/

const carriesCustomProperty = (value: string): boolean => CUSTOM_PROPERTY.test(value)

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
          !(carriesProperty(lineText, match.index) || carriesCustomProperty(match[0])),
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
