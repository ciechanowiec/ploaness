import path from 'node:path'
import { maskLiterals, stripComments, withoutComments } from './source-text.js'

/** A file the coverage question is answered from: its repository path and its text. */
export interface SpecSource {
  readonly path: string
  readonly source: string
}

// Recognize axe identifiers in code, excluding comments, strings, and regex literals.
const AXE_MARKERS: readonly string[] = ['AxeBuilder', 'axe.run']

const REGEX_METACHARACTERS: RegExp = /[$()*+.?[\\\]^{|}]/gu

const escaped = (text: string): string => text.replaceAll(REGEX_METACHARACTERS, String.raw`\$&`)

// An import specifier is a path too, and `@/lib/calendar/interval` contains `/calendar`. Read as a
// route, that made every unit spec of a `calendar` module look like a test driving the view - and a
// spec that also imported the shared axe helper would then have answered for a view nothing scans,
// which is a false PASS and the one failure a gate must never have. Specifiers and comments are
// removed before the search; `importedSources` reads the specifiers from the original text, where
// they still are.
const MODULE_SPECIFIER: RegExp = /\b(?:from|import)\s*(?:\(\s*)?['"][^'"]*['"]/gu

const routeText = (source: string): string =>
  withoutComments(source).replaceAll(MODULE_SPECIFIER, '')

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
  AXE_MARKERS.some((marker: string): boolean => maskLiterals(source).includes(marker))

const RELATIVE_IMPORT: RegExp = /\bfrom\s*['"](\.[^'"]*)['"]/gu

// Resolve from the importing file, without accessing the filesystem. All candidates were already read.
const matchesFile = (specifier: string, importer: string, candidate: string): boolean => {
  const resolved: string = path.posix.normalize(
    path.posix.join(path.posix.dirname(importer), specifier),
  )
  const stem: string = resolved.replace(/\.[cm]?jsx?$/u, '')
  return [
    resolved,
    ...['.ts', '.tsx', '.mts', '.cts', '/index.ts', '/index.tsx'].map(
      (suffix: string): string => `${stem}${suffix}`,
    ),
  ].includes(candidate)
}

const importedSources = (
  spec: SpecSource,
  everyFile: readonly SpecSource[],
): readonly SpecSource[] =>
  [...stripComments(spec.source).matchAll(RELATIVE_IMPORT)].flatMap(
    (match: RegExpExecArray): SpecSource[] =>
      everyFile.filter((candidate: SpecSource): boolean =>
        matchesFile(match[1] ?? '', spec.path, candidate.path),
      ),
  )

/**
 * Whether a specification scans with axe, directly or through a helper it imports.
 *
 * This is static source evidence through at most one helper import. It does not establish execution;
 * the end-to-end suite must run the scan.
 * @param spec the specification being judged.
 * @param everyFile every file it may import a scan from, the specifications included.
 * @returns true when the source names axe directly or through an imported helper.
 */
export const reachesAxe = (spec: SpecSource, everyFile: readonly SpecSource[]): boolean =>
  carriesAxe(spec.source) ||
  importedSources(spec, everyFile).some((imported: SpecSource): boolean =>
    carriesAxe(imported.source),
  )
