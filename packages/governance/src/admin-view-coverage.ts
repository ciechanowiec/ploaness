// Custom admin views, and the accessibility hole they sit in.
//
// The pinned sweep skips `/admin` unconditionally, and correctly: the panel is Payload's markup rather
// than the project's, and the crawl carries no credential to sign in with. A CUSTOM admin view is the
// one thing inside that exemption the project wrote itself, and nothing else in the harness will ever
// look at it. `jsx-a11y` reads the source, so it cannot see contrast, focus order, or a landmark whose
// role depends on where the framework's template put the markup - and that last one is not
// hypothetical: a bare `header` in a custom view becomes a second `banner` beside the panel's own,
// which is invisible until something renders it.
//
// ploaness cannot do the scanning. It cannot sign in, it does not know which container belongs to the
// project rather than to Payload, and a scan of the whole panel would report defects in components
// nobody working in that project can repair. What it can do is refuse to let the view go unlooked at.
// The configuration says a custom view exists; a spec has to say something scans it.
//
// This is the same shape as the anonymous-grant rule: the framework will happily leave a decision
// unmade, so the project is required to have made it somewhere a check can see.
import type { PayloadViolation } from './payload-source.js'
import { balancedArguments, lineOf, stripComments } from './source-text.js'

/** A custom admin view a Payload configuration declares, and where it declares it. */
export interface DeclaredAdminView {
  readonly path: string
  readonly line: number
}

/** A file the coverage question is answered from: its repository path and its text. */
export interface SpecSource {
  readonly path: string
  readonly source: string
}

// What proves a file reaches axe. The builder's class name covers the Playwright and WebdriverIO
// packages alike, the scoped package name covers a bare import, and `axe.run` covers the browser
// script form. A project driving axe some fourth way is asked to say so rather than assumed to have
// nothing.
const AXE_MARKERS: readonly string[] = ['AxeBuilder', '@axe-core', 'axe.run']

const REGEX_METACHARACTERS: RegExp = /[$()*+.?[\\\]^{|}]/gu

const escaped = (text: string): string => text.replaceAll(REGEX_METACHARACTERS, String.raw`\$&`)

// An import specifier is a path too, and `@/lib/calendar/interval` contains `/calendar`. Read as a
// route, that made every unit spec of a `calendar` module look like a test driving the view - and a
// spec that also imported the shared axe helper would then have answered for a view nothing scans,
// which is a false PASS and the one failure a gate must never have. Specifiers and comments are
// removed before the search; `importedSources` reads the specifiers from the original text, where
// they still are.
const MODULE_SPECIFIER: RegExp = /\b(?:from|import)\s*(?:\(\s*)?['"][^'"]*['"]/gu

const routeText = (source: string): string => stripComments(source).replaceAll(MODULE_SPECIFIER, '')

// A view path is a route prefix, so a bare `includes` would let a spec for `/calendar-archive` answer
// for `/calendar`. The character after the match has to end the route.
const containsRoute = (source: string, route: string): boolean =>
  new RegExp(String.raw`${escaped(route)}(?![\w-])`, 'u').test(routeText(source))

const carriesAxe = (source: string): boolean =>
  AXE_MARKERS.some((marker: string): boolean => source.includes(marker))

const RELATIVE_IMPORT: RegExp = /\bfrom\s*['"](\.[^'"]*)['"]/gu

// Resolved by the tail of the specifier rather than by walking the filesystem, because this module
// takes plain values and owns no path resolver. `../helpers/accessibility` matches
// `tests/helpers/accessibility.ts`, which is the shape every project writes; a specifier that resolves
// somewhere genuinely different would have to end in the same segments to be confused with it.
const matchesFile = (specifier: string, filePath: string): boolean => {
  const tail: string = specifier.replace(/^(?:\.\.?\/)+/u, '')
  return ['.ts', '.tsx', '/index.ts', '/index.tsx'].some((suffix: string): boolean =>
    filePath.endsWith(`${tail}${suffix}`),
  )
}

const importedSources = (
  spec: SpecSource,
  everyFile: readonly SpecSource[],
): readonly SpecSource[] =>
  [...spec.source.matchAll(RELATIVE_IMPORT)].flatMap((match: RegExpExecArray): SpecSource[] =>
    everyFile.filter((candidate: SpecSource): boolean =>
      matchesFile(match[1] ?? '', candidate.path),
    ),
  )

// One hop, deliberately. A spec that scans through a helper is the ordinary arrangement and has to be
// recognised; a chain deeper than that is a project hiding its own scan from itself, and following it
// would trade a rule anyone can predict for one nobody can.
const reachesAxe = (spec: SpecSource, everyFile: readonly SpecSource[]): boolean =>
  carriesAxe(spec.source) ||
  importedSources(spec, everyFile).some((imported: SpecSource): boolean =>
    carriesAxe(imported.source),
  )

// `components` then `views`, each read as the block it opens rather than as text found anywhere in the
// file. Nesting the two is what tells Payload's own vocabulary apart from a project's: a `views` key
// that is not inside a `components` block is not a custom admin view.
const BLOCK_PATTERNS: readonly string[] = [
  String.raw`\bcomponents\s*:\s*\{`,
  String.raw`\bviews\s*:\s*\{`,
]

const VIEW_PATH: RegExp = /\bpath\s*:\s*['"](\/[^'"]*)['"]/gu

interface Block {
  readonly text: string
  readonly start: number
}

// The brace-delimited body opened at `at`, carrying the offset it starts at so that a match inside it
// can be reported at its line in the whole file rather than at its line in the fragment. The scan is
// `balancedArguments`, which skips string literals - a brace inside a quoted string would otherwise
// close the block early and hide every view declared after it.
const blockAt = (source: string, at: number): Block | undefined => {
  const text: string | undefined = balancedArguments(source, at)
  return text === undefined ? undefined : { text, start: at + 1 }
}

const blocksMatching = (blocks: readonly Block[], pattern: string): readonly Block[] =>
  blocks.flatMap((block: Block): readonly Block[] =>
    [...block.text.matchAll(new RegExp(pattern, 'gu'))].flatMap(
      (match: RegExpExecArray): Block[] => {
        const opened: Block | undefined = blockAt(block.text, match.index + match[0].length - 1)
        return opened === undefined
          ? []
          : [{ text: opened.text, start: block.start + opened.start }]
      },
    ),
  )

/**
 * The custom admin views a Payload configuration declares.
 *
 * Both `admin.components.views` and a collection's own are found, because both produce a route the
 * pinned sweep will not reach and both are the project's markup.
 * @param source the file's text.
 * @returns one entry per declared view path, in the order the file declares them.
 */
export const findDeclaredAdminViews = (source: string): readonly DeclaredAdminView[] => {
  const code: string = stripComments(source)
  const views: readonly Block[] = BLOCK_PATTERNS.reduce(
    (blocks: readonly Block[], pattern: string): readonly Block[] =>
      blocksMatching(blocks, pattern),
    [{ text: code, start: 0 }],
  )
  return views.flatMap((block: Block): DeclaredAdminView[] =>
    [...block.text.matchAll(VIEW_PATH)].map(
      (match: RegExpExecArray): DeclaredAdminView => ({
        path: match[1] ?? '',
        line: lineOf(code, block.start + match.index),
      }),
    ),
  )
}

/**
 * The declared views that no specification scans for accessibility.
 * @param views the views a configuration declares.
 * @param specs the project's test files, which is where a scan would be written.
 * @param everyFile every file a spec may import a scan from, the specs included.
 * @returns one violation per view nothing looks at.
 */
export const findUnscannedAdminViews = (
  views: readonly DeclaredAdminView[],
  specs: readonly SpecSource[],
  everyFile: readonly SpecSource[],
): readonly PayloadViolation[] =>
  views.flatMap((view: DeclaredAdminView): PayloadViolation[] => {
    const driving: readonly SpecSource[] = specs.filter((spec: SpecSource): boolean =>
      containsRoute(spec.source, view.path),
    )
    if (driving.length === 0) {
      return [
        {
          line: view.line,
          rule: 'admin-view-undriven',
          reason:
            `no test drives the custom admin view at "${view.path}". It is this project's own ` +
            'markup inside the panel the accessibility sweep skips, so nothing else will ever look ' +
            'at it: give it an end-to-end spec that scans it with axe, scoped to the view container',
        },
      ]
    }
    return driving.some((spec: SpecSource): boolean => reachesAxe(spec, everyFile))
      ? []
      : [
          {
            line: view.line,
            rule: 'admin-view-unscanned',
            reason:
              `the custom admin view at "${view.path}" is driven by a test but nothing scans it ` +
              'with axe. The pinned sweep skips the admin panel, so this view has no accessibility ' +
              'coverage at all: add a scan scoped to the view container, not to the whole panel',
          },
        ]
  })
