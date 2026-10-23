// Read one resource type's blocks out of an OpenTofu or Terraform source, line by line.
//
// A block is read from its header to the next line that closes or opens a top-level block. Formatted
// HCL closes a resource at column 0; unformatted HCL over-reads at worst the blank lines before the next
// block, never the next block's attributes. Nothing here parses HCL structure: a rule built on this
// decides only what a literal argument on its own line can decide.

const FIRST_LINE: number = 1

const BLOCK_BOUNDARY: RegExp = /^(?:\}|(?:resource|data|module|variable|output|locals|provider|terraform)\b)/

/** One resource block: the line its header sits on, and the lines of its body. */
export interface ResourceBlock {
  readonly line: number
  readonly body: readonly string[]
}

const headerOf = (type: string): RegExp => new RegExp(String.raw`^[ \t]*resource[ \t]+"${type}"`)

/**
 * Every block declaring one resource type.
 * @param lines the source's lines, comments already blanked by the caller.
 * @param type the resource type, such as `aws_cloudfront_function`.
 * @returns one block per header, in source order.
 */
export const resourceBlocksIn = (lines: readonly string[], type: string): readonly ResourceBlock[] => {
  const header: RegExp = headerOf(type)
  return lines.flatMap((line: string, index: number): readonly ResourceBlock[] => {
    if (!header.test(line)) {
      return []
    }
    const rest: readonly string[] = lines.slice(index + 1)
    const end: number = rest.findIndex((candidate: string): boolean => BLOCK_BOUNDARY.test(candidate))
    return [{ line: index + FIRST_LINE, body: end === -1 ? rest : rest.slice(0, end) }]
  })
}
