// The versions a governed project declares, and every way it could change one without saying so.
//
// This is the wiring module's other half. `wiring-policy.ts` judges the files a project points at
// ploaness with; this judges the numbers beside its dependencies. The two were one file until it passed
// the size cap, which is the cap doing its job: they answer different questions and share only the
// helpers below.
import { findOverrides, OVERRIDE_KEYS, type OverrideEntry } from './install-policy.js'
import { asOptionalText, asRecord, asStringRecord, declaredDependencies } from './json-shapes.js'
import type { WiringViolation } from './wiring-violation.js'

/** What a project must declare and at which version, plus the invariants those pins imply. */
export interface VersionInputs {
  /** Every pinned package, mapped to the exact version ploaness owns for it. */
  readonly expected: Readonly<Record<string, string>>
  /** The subset a project must declare rather than merely match when present. */
  readonly required: ReadonlySet<string>
  /** The version every `@payloadcms/*` package must carry, which is the pinned `payload` version. */
  readonly payloadVersion: string | undefined
  /** The exact `packageManager` field, or undefined when ploaness pins none. */
  readonly requiredPackageManager: string | undefined
  /** The `engines` block a project must declare. */
  readonly requiredEngines: Readonly<Record<string, string>>
  /** The contents of pnpm-workspace.yaml, or an empty string when the project ships none. */
  readonly workspaceFile: string
}

// Which block a package is actually declared in. A finding that named `devDependencies` for a package
// sitting in `dependencies` sent the reader to the wrong half of the file - and the framework pins,
// which are runtime dependencies, are exactly the ones that would be misreported.
const blockOf = (packageJson: Record<string, unknown>, name: string): string | undefined => {
  if (Object.hasOwn(asStringRecord(packageJson['dependencies']), name)) {
    return 'dependencies'
  }
  return Object.hasOwn(asStringRecord(packageJson['devDependencies']), name)
    ? 'devDependencies'
    : undefined
}

/**
 * How a finding names what it actually found.
 *
 * Exported because `wiring-policy.ts` reported the same thing in the same words with its own copy of
 * this function, and the two modules already share this direction of import.
 * @param found the declared value, or undefined when the key is absent.
 * @returns `missing`, or the value in quotes.
 */
export const describeFound = (found: string | undefined): string =>
  found === undefined ? 'missing' : `"${found}"`

// The harness's own packages, pointed at a local artefact. A consumer verifying ploaness before it is
// published resolves them from a tarball, and that is the arrangement `it/verify.sh` exists to exercise
// - so the rule has to permit it deliberately. It permitted it by accident until now: the override
// reader split the line at its LAST colon, so `ploaness: "file:../ploaness-1.0.0.tgz"` parsed as a
// package called `ploaness: "file` and matched nothing. Repairing the reader turned an accident into a
// finding, which is the right time to say what was actually intended.
const HARNESS_SCOPE: string = '@ploaness/'
const HARNESS_PACKAGE: string = 'ploaness'
const LOCAL_ARTEFACT: RegExp = /^(?:file|link|workspace):/

const isHarnessTarball = (entry: OverrideEntry): boolean =>
  (entry.packageName === HARNESS_PACKAGE || entry.packageName.startsWith(HARNESS_SCOPE)) &&
  LOCAL_ARTEFACT.test(entry.specifier)

const overrideViolation = (
  entry: OverrideEntry,
  expected: Readonly<Record<string, string>>,
  declared: Record<string, string>,
): readonly WiringViolation[] => {
  if (isHarnessTarball(entry)) {
    return []
  }
  const location: string = `pnpm-workspace.yaml ${entry.key}.${entry.packageName}`
  if (Object.hasOwn(expected, entry.packageName)) {
    return [
      {
        location,
        reason:
          'redefines a version ploaness pins; remove it, because the pin decides what the ' +
          'gates run against',
      },
    ]
  }
  const own: string | undefined = declared[entry.packageName]
  return own === undefined
    ? []
    : [
        {
          location,
          reason:
            `overrides a package the project declares at "${own}"; change the declaration ` +
            'instead, or the installed version is not the declared one',
        },
      ]
}

// A project may override what it does not declare, and may not override what it does. The permitted
// case is a transitive package carrying an advisory with no upgrade path above it, which the project
// can reach no other way and which the standard says to resolve by upgrading rather than excusing. The
// forbidden case is a package whose version the project already wrote down: two declarations of one
// version will not stay equal, and the one that loses is the one every reader believes. The ploaness
// packages are neither, so a pre-publication consumer may still point them at a local tarball.
const checkPinnedOverrides = (
  workspaceFile: string,
  expected: Readonly<Record<string, string>>,
  packageJson: Record<string, unknown>,
): readonly WiringViolation[] => {
  const declared: Record<string, string> = declaredDependencies(packageJson)
  return findOverrides(workspaceFile).flatMap((entry: OverrideEntry): readonly WiringViolation[] =>
    overrideViolation(entry, expected, declared),
  )
}

// Corepack reads `packageManager` and runs exactly that version, so it decides how every other pinned
// version is resolved. A project on a different pnpm can produce a different tree from the same
// lockfile, which makes every pin above it a statement about a graph nobody built.
const checkPackageManager = (
  packageJson: Record<string, unknown>,
  required: string | undefined,
): readonly WiringViolation[] => {
  if (required === undefined) {
    return []
  }
  const declared: unknown = packageJson['packageManager']
  return declared === required
    ? []
    : [
        {
          location: 'package.json packageManager',
          reason: `is ${describeFound(asOptionalText(declared))} but ploaness requires "${required}"`,
        },
      ]
}

// `preflight` checks the Node that is actually running, which is the version a gate is executed by.
// The `engines` block is a different statement: it is what the project tells an installer, a CI image
// and a reader to use. Leaving it unchecked let a project declare a runtime ploaness refuses.
const checkEngines = (
  packageJson: Record<string, unknown>,
  required: Readonly<Record<string, string>>,
): readonly WiringViolation[] => {
  const declared: Record<string, string> = asStringRecord(packageJson['engines'])
  return Object.entries(required).flatMap(
    ([name, range]: readonly [string, string]): readonly WiringViolation[] =>
      declared[name] === range
        ? []
        : [
            {
              location: `package.json engines.${name}`,
              reason: `is ${describeFound(declared[name])} but ploaness requires "${range}"`,
            },
          ],
  )
}

// The same four keys `install-policy.ts` reads out of the workspace file, read here out of package.json
// instead: an override or resolution declared locally; a patch, which swaps a package's code while its
// version says otherwise; and a package extension, which rewrites a manifest the resolver then obeys.
// None is visible in the dependency block a reader checks, which is what makes them worth naming - and
// the list is imported rather than restated, because two copies of it in one gate will not stay equal.

// A patch is keyed by `name@version`, and a scoped name begins with the same character, so the split is
// on the last `@` rather than the first.
const packageNameOf = (key: string): string => {
  const at: number = key.lastIndexOf('@')
  return at > 0 ? key.slice(0, at) : key
}

const escapeEntries = (packageJson: Record<string, unknown>): readonly (readonly string[])[] =>
  OVERRIDE_KEYS.flatMap((key: string): readonly (readonly string[])[] =>
    [packageJson, asRecord(packageJson['pnpm'])].flatMap(
      (holder: Record<string, unknown>): readonly (readonly string[])[] =>
        Object.keys(asRecord(holder[key])).map((entry: string): readonly string[] => [key, entry]),
    ),
  )

const checkVersionEscapes = (
  packageJson: Record<string, unknown>,
  expected: Readonly<Record<string, string>>,
): readonly WiringViolation[] =>
  escapeEntries(packageJson)
    .filter(([, entry]: readonly string[]): boolean =>
      Object.hasOwn(expected, packageNameOf(entry ?? '')),
    )
    .map(
      ([key, entry]: readonly string[]): WiringViolation => ({
        location: `package.json ${key ?? ''}.${entry ?? ''}`,
        reason:
          'changes what a version ploaness pins installs; the pin decides what the gates run ' +
          'against, and a project cannot answer for a version it did not choose',
      }),
    )

// A specifier that is not a registry version at all: a local tarball, a workspace link, a git or npm
// alias. None of them is a range, and a pre-publication consumer resolves the ploaness packages this
// way, so the range ban must read past them rather than through them.
const NON_REGISTRY: RegExp = /^(?:file|link|workspace|catalog|git\+[a-z]+|git|github|npm|https?):/

// Anything that resolves to "whichever version is newest at install time". The standard pins the
// toolchain so an upstream release cannot change a verdict while the project stays unchanged, and a
// range on an application dependency is the same hole one layer down: the build, the suite and the
// end-to-end run all execute against something nobody wrote down. `*` and an empty specifier are the
// widest ranges of all rather than exceptions to the rule.
const RANGE_OPERATOR: RegExp = /^\s*(?:[\^~><=*]|$)/
// A union, a hyphen range, or an `x` standing in for a whole version component. Each `x` form is
// anchored at a component boundary: written unanchored, `.x` also matched a legitimate exact
// prerelease such as `1.0.0-canary.x1` and reported it as a range.
const RANGE_UNION: RegExp = /\|\||\s-\s|(?:^|[.\s])x(?:[.\s]|$)/

// An exact version begins with a digit. Everything else that is neither a range operator nor a
// non-registry specifier is a DIST TAG - `latest`, `next`, `beta` - which is the widest range of all:
// it resolves to whatever the publisher moved the tag to since the project last installed. The rule
// used to test only for range syntax, so every dist tag passed as though it were a pinned version.
const EXACT_VERSION: RegExp = /^\d/

// An `npm:` alias names a registry package like any other declaration - `npm:preact@^10` carries a
// range, and reading past the whole prefix let it through. Only the version half is judged, by the same
// rule; the alias itself is a naming decision the project is entitled to make.
const NPM_ALIAS: string = 'npm:'

const isExactVersion = (specifier: string): boolean => {
  if (specifier.startsWith(NPM_ALIAS)) {
    const aliased: string = specifier.slice(NPM_ALIAS.length)
    const at: number = aliased.lastIndexOf('@')
    return at > 0 && isExactVersion(aliased.slice(at + 1))
  }
  if (NON_REGISTRY.test(specifier)) {
    return true
  }
  if (RANGE_OPERATOR.test(specifier) || RANGE_UNION.test(specifier)) {
    return false
  }
  return EXACT_VERSION.test(specifier)
}

const checkExactVersions = (packageJson: Record<string, unknown>): readonly WiringViolation[] =>
  Object.entries(declaredDependencies(packageJson))
    .filter(([, specifier]: readonly [string, string]): boolean => !isExactVersion(specifier))
    .map(
      ([name, specifier]: readonly [string, string]): WiringViolation => ({
        location: `package.json ${name}`,
        reason:
          `is "${specifier}", which is a range; declare one exact version, because a range ` +
          'lets an upstream release change what the gates run against',
      }),
    )

// Payload refuses to boot, or fails in ways that read as application defects, when its own packages
// disagree about their version. The rule is derived from the pinned `payload` rather than written as a
// list, so a project adding `@payloadcms/plugin-form-builder` is covered by the rule that already
// exists instead of by an entry somebody has to remember.
const PAYLOAD_SCOPE: string = '@payloadcms/'

const checkPayloadFamily = (
  packageJson: Record<string, unknown>,
  payloadVersion: string | undefined,
): readonly WiringViolation[] => {
  if (payloadVersion === undefined) {
    return []
  }
  return Object.entries(declaredDependencies(packageJson))
    .filter(
      ([name, version]: readonly [string, string]): boolean =>
        name.startsWith(PAYLOAD_SCOPE) && version !== payloadVersion,
    )
    .map(
      ([name, version]: readonly [string, string]): WiringViolation => ({
        location: `package.json ${name}`,
        reason:
          `is "${version}" but payload is pinned at "${payloadVersion}"; ` +
          'Payload fails at runtime when its own packages disagree',
      }),
    )
}

// Two obligations, not one. A project must DECLARE the few packages every project uses, because under
// the strict pnpm layout its own specs could not resolve them otherwise. Every other pinned package
// must MATCH when the project declares it, but is not forced on a project that has no use for it -
// requiring a declaration there would manufacture a dependency the dead-code gate then reports as
// unused. Either way no pinned version can float, which is the point.
const checkTestLibraries = (
  packageJson: Record<string, unknown>,
  expected: Readonly<Record<string, string>>,
  required: ReadonlySet<string>,
): readonly WiringViolation[] => {
  const declared: Record<string, string> = declaredDependencies(packageJson)
  return Object.entries(expected).flatMap(
    ([name, version]: readonly [string, string]): readonly WiringViolation[] => {
      const found: string | undefined = declared[name]
      if (found === undefined) {
        return required.has(name)
          ? [
              {
                location: `package.json ${name}`,
                reason: `missing; ploaness pins it, so the project must declare it at ${version}`,
              },
            ]
          : []
      }
      return found === version
        ? []
        : [
            {
              location: `package.json ${blockOf(packageJson, name) ?? ''}.${name}`,
              reason:
                `is "${found}" but ploaness pins it at "${version}"; ` +
                'a range lets an upstream release change a verdict',
            },
          ]
    },
  )
}

/**
 * Return every way the project has changed, or could change, a version ploaness owns.
 * @param packageJson the consumer's parsed package.json.
 * @param inputs the pinned versions and the invariants they imply.
 * @returns one violation per defect, in a stable order.
 */
export const findVersionViolations = (
  packageJson: Record<string, unknown>,
  inputs: VersionInputs,
): readonly WiringViolation[] => [
  ...checkTestLibraries(packageJson, inputs.expected, inputs.required),
  ...checkExactVersions(packageJson),
  ...checkPayloadFamily(packageJson, inputs.payloadVersion),
  ...checkPackageManager(packageJson, inputs.requiredPackageManager),
  ...checkEngines(packageJson, inputs.requiredEngines),
  ...checkPinnedOverrides(inputs.workspaceFile, inputs.expected, packageJson),
  ...checkVersionEscapes(packageJson, inputs.expected),
]
