// What a project's own specifications say about a route, and whether one of them scans it.
//
// Two rules ask this same question of two different things. `admin-view-coverage` asks it of a custom
// admin view, which sits inside the `/admin` prefix the pinned sweep skips; `route-coverage` asks it
// of an application route the anonymous link crawl never reached. Neither can be answered by ploaness
// itself - it cannot sign in, and it cannot press the button that creates a record - so both answer it
// the same way: the project is required to have written the scan somewhere a check can see.
//
// It is one module rather than two copies because the load-bearing part is easy to omit and expensive
// to omit. `routeText` strips import specifiers before any route is searched for, and the comment on
// `MODULE_SPECIFIER` records what happened without it: `@/lib/calendar/interval` contains `/calendar`,
// so every unit spec of a `calendar` module looked like a test driving the view, and one that also
// imported the shared axe helper then answered for a view nothing scans. A second copy that forgot
// that line would ship the same false pass again.
import { stripComments } from './source-text.js'

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

// A regular expression literal, read loosely. `stripComments` blanks one along with the comments,
// because a `//` inside a pattern would otherwise open a comment that never closes - correct for a
// lexer, and fatal here: `page.waitForURL(/\/welcome$/u)` is how a Playwright specification names the
// address it is waiting for, and blanking it made the commonest idiom in the file invisible. So the
// literals are put back, extracted from the original text and searched alongside it.
//
// The pattern admits a little more than a real literal does - a division written with spaces around
// it can look like one - which only ever adds text to search, never removes it. What it costs is
// narrow and worth naming: a route spelled as a regular expression INSIDE a comment is no longer told
// apart from one in code, and will answer for its page. Refusing regular expressions altogether was
// the alternative, and it fails the ordinary case to close a hole nobody falls into by accident.
const REGEX_LITERAL: RegExp =
  /(?<![\w)\]])\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[])+\/[dgimsuvy]*/gu

// Comments go first, because a route named in one explaining why a page is NOT scanned would
// otherwise answer for that page.
const routeText = (source: string): string =>
  [
    stripComments(source).replaceAll(MODULE_SPECIFIER, ''),
    ...(source.match(REGEX_LITERAL) ?? []),
  ].join('\n')

/**
 * Whether a specification names one route.
 *
 * A route is a prefix of every longer route beneath it, so a bare `includes` would let a spec for
 * `/calendar-archive` answer for `/calendar`. The character after the match has to end the route.
 * @param source the specification's text.
 * @param route the route being looked for.
 * @returns true when the text drives that route and not merely one whose name starts the same way.
 */
export const containsRoute = (source: string, route: string): boolean =>
  new RegExp(String.raw`${escaped(route)}(?![\w-])`, 'u').test(routeText(source))

/**
 * Whether a specification BUILDS a URL beneath one route prefix.
 *
 * The evidence a dynamic route needs, and deliberately narrower than `containsRoute`. A spec cannot
 * contain `/play/[id]`, because that is a file path rather than an address: what it contains is
 * `/play/${gameId}`. Asking merely for the prefix would let a spec that visits `/play` answer for
 * `/play/[id]`, which is the false pass this whole family of rules exists to avoid - so what is
 * required is the prefix, a separator, and an interpolation, which together mean the spec computed an
 * address rather than typed one.
 * @param source the specification's text.
 * @param prefix the static part of the route, before its first dynamic segment.
 * @returns true when the text builds a URL below that prefix.
 */
export const containsBuiltRoute = (source: string, prefix: string): boolean =>
  routeText(source).includes(`${prefix === '/' ? '' : prefix}/\${`)

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

/**
 * Whether a specification scans with axe, directly or through a helper it imports.
 *
 * One hop, deliberately. A spec that scans through a helper is the ordinary arrangement and has to be
 * recognised; a chain deeper than that is a project hiding its own scan from itself, and following it
 * would trade a rule anyone can predict for one nobody can.
 * @param spec the specification being judged.
 * @param everyFile every file it may import a scan from, the specifications included.
 * @returns true when running that spec reaches axe.
 */
export const reachesAxe = (spec: SpecSource, everyFile: readonly SpecSource[]): boolean =>
  carriesAxe(spec.source) ||
  importedSources(spec, everyFile).some((imported: SpecSource): boolean =>
    carriesAxe(imported.source),
  )
