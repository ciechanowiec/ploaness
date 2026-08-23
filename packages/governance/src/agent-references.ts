// Shared AI-agent attribution ban: a governed repository's history must not record which automated
// agent, or which agent session, produced a change. Commit messages therefore carry no co-authorship
// trailer, vendor sign-off email, session identifier, or generated-by signature that attributes the
// change to an AI agent. This module is the single source of truth for the known attribution patterns;
// the commit-message gate (check-commit-message.ts) consumes it. Only structured attribution markers
// are matched, never a bare product name in prose: this repository ships agent instructions and
// documents such tools by name, so a commit like "docs: explain the claude code skill" must pass.

interface AgentReferencePattern {
  readonly pattern: RegExp
  readonly label: string
}

// Named automated coding agents and their vendors, as one alternation fragment reused across patterns.
// The set is the "known ones" the ban targets; extend it as new agents appear (no pattern can know them
// all, so the guideline also states the rule in prose for an inspector to apply).
const AGENT_NAMES: string = [
  'claude|anthropic|copilot|cursor|codex|chatgpt|openai',
  'gpt(?:[- ][0-9a-z.]+)?|devin|aider|windsurf|opencode',
  'gemini|bard|codeium|tabnine|sourcegraph|cody',
].join('|')

const AGENT_REFERENCE_PATTERNS: readonly AgentReferencePattern[] = [
  {
    // A co-authorship trailer naming a known agent, e.g. "Co-Authored-By: Claude <...>".
    pattern: new RegExp(String.raw`co-authored-by:[^\n]*\b(?:${AGENT_NAMES})\b`, 'i'),
    label: 'agent co-authorship trailer',
  },
  {
    // An agent vendor's sign-off address, e.g. the "noreply@anthropic.com" author Claude Code stamps.
    pattern: /\b[\w.+-]*@(?:anthropic|openai|cursor|devin|aider)\.(?:com|ai|dev)\b/i,
    label: 'agent vendor email',
  },
  {
    // A session identifier an agent stamps on its work, e.g. "Claude-Session:" or "Codex-Session-Id:".
    pattern: new RegExp(
      String.raw`\b(?:${AGENT_NAMES}|agent|assistant)[- ]?session(?:[- ]?id)?\s*:`,
      'i',
    ),
    label: 'agent session identifier',
  },
  {
    // A generated-by signature, e.g. "Generated with Claude Code" or its robot-emoji-prefixed variant.
    pattern: new RegExp(String.raw`generated\s+(?:with|by)\s.*\b(?:${AGENT_NAMES})\b`, 'i'),
    label: 'agent generation signature',
  },
  {
    // The Claude Code product signature link, e.g. "[Claude Code](https://claude.com/claude-code)".
    pattern: /claude\.(?:ai|com)\/claude-code/i,
    label: 'agent product signature',
  },
]

export interface AgentReferenceMatch {
  readonly line: number
  readonly label: string
}

const findMatchesInLine = (line: string, lineNumber: number): readonly AgentReferenceMatch[] =>
  AGENT_REFERENCE_PATTERNS.flatMap(
    (entry: AgentReferencePattern): readonly AgentReferenceMatch[] =>
      entry.pattern.test(line) ? [{ line: lineNumber, label: entry.label }] : [],
  )

/**
 * Scans text for references that attribute a change to an AI agent or its session, reporting the
 * 1-based line and the kind of attribution matched.
 * @param text the content to scan, with lines separated by "\n".
 * @returns one match per attribution marker found, in reading order.
 */
export const findAgentReferences = (text: string): readonly AgentReferenceMatch[] =>
  text
    .split('\n')
    .flatMap((line: string, index: number): readonly AgentReferenceMatch[] =>
      findMatchesInLine(line, index + 1),
    )
