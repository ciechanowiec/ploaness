// The shipped Stylelint configuration, exercised against the dialect it has to accept.
//
// This spec lives here rather than beside the other config specs because stylelint is a dependency of
// @ploaness/cli, the package that runs it, and under pnpm's strict layout it resolves from nowhere else.
//
// It lints real Tailwind v4 source through the shipped file rather than asserting that the JSON contains
// certain strings. A spec of the second kind passes while the config rejects every stylesheet a project
// would actually write: the entry it asserts on could be spelled wrongly, scoped to the wrong rule, or
// overridden by the standard config it extends, and nothing would fail.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import stylelint, { type LinterResult, type Warning } from 'stylelint'
import { describe, expect, it } from 'vitest'

const specDirectory: string = path.dirname(fileURLToPath(import.meta.url))
const SHIPPED_CONFIG: string = path.join(specDirectory, '..', '..', 'config', 'stylelint.json')

// Every at-rule Tailwind v4 defines, and both import forms, in one stylesheet. Written as the source a
// project writes rather than as a list of tokens, because an at-rule is only accepted in the position it
// is used in: `@theme` carries a block, `@source` does not, and a rule can pass one and fail the other.
const TAILWIND_V4: string = `@import "tailwindcss";
@import "./local.css" layer(base);

@source "../components";
@plugin "@tailwindcss/typography";
@config "../tailwind.config.js";
@reference "../app.css";

@custom-variant pointer-coarse (@media (pointer: coarse));

@theme {
  --color-brand: #0a7;
}

@utility tab-4 {
  tab-size: 4;
}

@variant dark {
  background: #000;
}

.card {
  @apply rounded-lg p-4;
}
`

const lint = async (code: string): Promise<readonly Warning[]> => {
  const result: LinterResult = await stylelint.lint({
    code,
    configFile: SHIPPED_CONFIG,
    codeFilename: 'src/app/styles.css',
  })
  return result.results.flatMap(
    (one: LinterResult['results'][number]): readonly Warning[] => one.warnings,
  )
}

describe('the shipped Stylelint configuration and Tailwind v4', () => {
  it('accepts a stylesheet written in the dialect, at-rules and imports alike', async () => {
    expect(await lint(TAILWIND_V4)).toEqual([])
  })

  // The list is an allowance for a dialect, not a hole in the rule. A project that misspells an at-rule
  // still hears about it, which is the property that would be lost by turning at-rule-no-unknown off.
  it('still rejects an at-rule that belongs to no dialect, so a typo is not silently accepted', async () => {
    const warnings: readonly Warning[] = await lint('@theem {\n  color: #000;\n}\n')
    expect(warnings.map((warning: Warning): string | undefined => warning.rule)).toContain(
      'at-rule-no-unknown',
    )
  })

  // `import-notation` is set rather than disabled: Tailwind mandates the string form, so the rule now
  // enforces the notation a project can actually write instead of the one it cannot.
  it('holds imports to one notation, which is the form Tailwind requires', async () => {
    const warnings: readonly Warning[] = await lint('@import url("tailwindcss");\n')
    expect(warnings.map((warning: Warning): string | undefined => warning.rule)).toContain(
      'import-notation',
    )
  })
})
