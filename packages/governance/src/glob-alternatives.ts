/** Bound brace expansion so a configuration cannot consume unbounded analyzer resources. */
const MAX_ALTERNATIVES: number = 256
const MIN_CHOICES: number = 2
const INNER_BRACES: RegExp = /\{([^{}]*)\}/u

/** Expand comma-separated brace alternatives, retaining all other glob syntax verbatim. */
const expand = (pattern: string, budget: number): readonly string[] => {
  const group: RegExpExecArray | null = INNER_BRACES.exec(pattern)
  if (group === null) {
    if (pattern.includes('{') || pattern.includes('}')) {
      throw new Error(`invalid glob "${pattern}": unbalanced braces; use balanced comma-separated alternatives`)
    }
    return [pattern]
  }
  const choices: readonly string[] = (group[1] ?? '').split(',')
  if (choices.length < MIN_CHOICES || choices.some((choice: string): boolean => choice.length === 0)) {
    throw new Error(`invalid glob "${pattern}": braces require nonempty comma-separated alternatives`)
  }
  if (choices.length > budget) {
    throw new Error(`glob "${pattern}" exceeds ${String(MAX_ALTERNATIVES)} alternatives; split the declaration`)
  }
  const expanded: readonly string[] = choices.flatMap((choice: string): readonly string[] =>
    expand(
      `${pattern.slice(0, group.index)}${choice}${pattern.slice(group.index + group[0].length)}`,
      budget / choices.length,
    ),
  )
  return expanded
}

/** Expand bounded brace alternatives without filesystem access. */
export const globAlternatives = (pattern: string): readonly string[] => expand(pattern, MAX_ALTERNATIVES)
