// What a repository is made of: where its root is, which directories are pnpm projects, and which of
// those ploaness governs.
//
// ploaness governed exactly one package until now - `process.cwd()`, with every path joined onto it. That
// was not a simplification of workspaces, it was blindness to them: run from a member, the gates read the
// member's directory for files that only exist at the workspace root, and two of them reported a verdict
// about a file they had not found. This module is the missing distinction, kept pure so the rules about
// which directories are governed can be spec'd against directory lists no filesystem has to produce.
import { matchesGlob } from './file-roles.js'
import { declaredDependencies } from './json-shapes.js'
import { HARNESS_PACKAGE, PAYLOAD_PACKAGE } from './version-policy.js'
import { topLevelListItems } from './yaml-blocks.js'

/** The repo-relative path of the member that sits at the repository root. */
export const ROOT_MEMBER_PATH: string = '.'

/** The workspace file key naming the directories pnpm treats as projects. */
const PACKAGES_KEY: string = 'packages'

/** A directory holding a package.json, and what that manifest declares. */
export interface ProjectManifest {
  /** Repo-relative, {@link ROOT_MEMBER_PATH} for the repository root. */
  readonly path: string
  readonly packageJson: unknown
}

/** A governed member, reduced to what the repository-scope rules need to know about it. */
export interface MemberShape {
  readonly path: string
  readonly isPayload: boolean
  /** The member's own source roots, used to decide whether a nested project is already covered. */
  readonly sourceRoots: readonly string[]
}

/**
 * Locate the repository root from the directories above the working directory.
 *
 * Deliberately not `git rev-parse --show-toplevel`. The integration fixtures run cases in directories
 * that are never `git init`-ed, and asking git there walks out of the fixture and adopts whichever
 * repository happens to contain the temporary directory - so a case would be judged against a tree
 * nobody wrote. A workspace file is the stronger signal anyway: it is what pnpm itself reads to decide
 * where the workspace begins.
 * @param ancestors the working directory first, then each parent up to the filesystem root.
 * @param hasEntry whether a directory holds a named entry.
 * @returns the repository root, falling back to the working directory when nothing above it qualifies.
 */
export const findRepositoryRoot = (
  ancestors: readonly string[],
  hasEntry: (directory: string, entry: string) => boolean,
): string => {
  const workspace: string | undefined = ancestors.find((directory: string): boolean =>
    hasEntry(directory, 'pnpm-workspace.yaml'),
  )
  if (workspace !== undefined) {
    return workspace
  }
  const checkout: string | undefined = ancestors.find(
    (directory: string): boolean =>
      hasEntry(directory, '.git') && hasEntry(directory, 'package.json'),
  )
  return checkout ?? ancestors[0] ?? ROOT_MEMBER_PATH
}

/**
 * The directory patterns a workspace file declares.
 * @param workspaceFile the contents of pnpm-workspace.yaml, or an empty string when absent.
 * @returns one pattern per entry, in declaration order, including any leading-`!` exclusions.
 */
export const readWorkspacePackages = (workspaceFile: string): readonly string[] =>
  topLevelListItems(workspaceFile, PACKAGES_KEY)

const EXCLUSION_MARKER: string = '!'

// pnpm applies every exclusion after every inclusion rather than in written order, so a directory named
// by both is excluded whichever came first. Reading them in order would make the result depend on how
// the file happens to be arranged.
const isSelected = (patterns: readonly string[], directory: string): boolean => {
  const isIncluded: boolean = patterns
    .filter((pattern: string): boolean => !pattern.startsWith(EXCLUSION_MARKER))
    .some((pattern: string): boolean => matchesGlob(pattern, directory))
  const isExcluded: boolean = patterns
    .filter((pattern: string): boolean => pattern.startsWith(EXCLUSION_MARKER))
    .some((pattern: string): boolean =>
      matchesGlob(pattern.slice(EXCLUSION_MARKER.length), directory),
    )
  return isIncluded && !isExcluded
}

/**
 * The directories a workspace file selects as pnpm projects.
 *
 * The repository root is always a project whether or not `packages:` names it: it carries the manifest
 * that declares the package manager, the engines and the scripts a run is invoked through, so a
 * repository whose root were not a project would have no place to state any of them.
 * @param patterns the declared directory patterns.
 * @param directoriesWithManifest every repo-relative directory holding a tracked package.json.
 * @returns the selected directories, root first, without duplicates.
 */
export const selectProjects = (
  patterns: readonly string[],
  directoriesWithManifest: readonly string[],
): readonly string[] => [
  ...(directoriesWithManifest.includes(ROOT_MEMBER_PATH) ? [ROOT_MEMBER_PATH] : []),
  ...directoriesWithManifest.filter(
    (directory: string): boolean =>
      directory !== ROOT_MEMBER_PATH && isSelected(patterns, directory),
  ),
]

const declaresPackage = (packageJson: unknown, packageName: string): boolean =>
  Object.hasOwn(declaredDependencies(packageJson), packageName)

/**
 * Whether a project's manifest declares ploaness, which is what makes it a governed member.
 *
 * The marker is not a switch a project flips to escape. Under pnpm's strict layout a package that does
 * not depend on ploaness cannot resolve `ploaness/biome`, `ploaness/eslint` or `ploaness/tsconfig.json`
 * from its own configuration files, so its wiring could not work whatever this rule said - and dropping
 * the declaration to avoid the gates is reported by {@link findUngovernedProjects} rather than obeyed.
 * @param packageJson the project's parsed manifest.
 * @returns true when ploaness is a declared dependency.
 */
export const isGovernedProject = (packageJson: unknown): boolean =>
  declaresPackage(packageJson, HARNESS_PACKAGE)

/**
 * Whether a project's manifest declares Payload, which decides the third scope.
 * @param packageJson the project's parsed manifest.
 * @returns true when payload is a declared dependency.
 */
export const isPayloadProject = (packageJson: unknown): boolean =>
  declaresPackage(packageJson, PAYLOAD_PACKAGE)

/**
 * The projects ploaness governs.
 *
 * A repository where nothing declares ploaness still has one member - its root - so a project that has
 * not been initialised yet is reported by `preflight` and `wiring` rather than by an empty run that
 * would look like a pass.
 * @param projects every pnpm project the workspace selects.
 * @returns the governed member paths, or the root alone when none qualifies.
 */
export const findGovernedMembers = (projects: readonly ProjectManifest[]): readonly string[] => {
  const governed: readonly string[] = projects
    .filter((project: ProjectManifest): boolean => isGovernedProject(project.packageJson))
    .map((project: ProjectManifest): string => project.path)
  return governed.length > 0 ? governed : [ROOT_MEMBER_PATH]
}

// A project inside a member's declared source roots is already judged as that member's source. Treating
// it as ungoverned would report every fixture and example directory a governed package legitimately
// carries.
const isCoveredBy = (member: MemberShape, projectPath: string): boolean =>
  member.sourceRoots.some((root: string): boolean =>
    projectPath.startsWith(
      member.path === ROOT_MEMBER_PATH ? `${root}/` : `${member.path}/${root}/`,
    ),
  )

/**
 * Report every pnpm project ploaness is not judging.
 *
 * This is the anti-bypass half of the member marker. Dropping `ploaness` from a package's manifest
 * removes it from the governed set, which without this rule would be a silent way to take a whole
 * application out of verification.
 * @param projects every pnpm project the workspace selects.
 * @param members the governed members.
 * @returns one finding per project that is neither governed nor inside a governed member's source.
 */
export const findUngovernedProjects = (
  projects: readonly ProjectManifest[],
  members: readonly MemberShape[],
): readonly string[] =>
  projects
    .filter((project: ProjectManifest): boolean => {
      const isMember: boolean = members.some(
        (member: MemberShape): boolean => member.path === project.path,
      )
      return !(
        isMember ||
        members.some((member: MemberShape): boolean => isCoveredBy(member, project.path))
      )
    })
    .map(
      (project: ProjectManifest): string =>
        `${project.path}/package.json: is a pnpm project ploaness does not govern; ` +
        `declare "${HARNESS_PACKAGE}" so its source is verified, or remove the package`,
    )

/**
 * Verify the repository is a Payload project.
 *
 * Asked of the repository rather than of one directory, because a workspace legitimately holds packages
 * that are not Payload applications. What ploaness refuses to judge is a repository with no Payload in
 * it at all, which is the same refusal `preflight` always made, moved up one level.
 * @param members the governed members.
 * @returns a single finding when no member declares payload.
 */
export const findPayloadMemberViolations = (members: readonly MemberShape[]): readonly string[] =>
  members.some((member: MemberShape): boolean => member.isPayload)
    ? []
    : [
        'no package in this repository declares "payload"; ploaness governs Payload CMS projects ' +
          'and will not judge another kind',
      ]

/** A member's declared origin, which the end-to-end run drives. */
export interface MemberOrigin {
  readonly path: string
  readonly serverUrl: string
}

/**
 * Report members that would drive the same origin.
 *
 * The end-to-end configuration starts the application and reuses an existing server when one already
 * answers. Two members sharing an origin therefore do not collide loudly: the second run finds the first
 * application still listening, sweeps it, and passes - reporting on an application that was never under
 * test. Nothing else in the harness can see that, and it exists only once more than one member has a
 * browser suite.
 * @param origins each member's path and declared origin.
 * @returns one finding per member sharing an origin with an earlier one.
 */
export const findServerUrlCollisions = (origins: readonly MemberOrigin[]): readonly string[] =>
  origins.flatMap((origin: MemberOrigin, index: number): readonly string[] => {
    const earlier: MemberOrigin | undefined = origins
      .slice(0, index)
      .find((other: MemberOrigin): boolean => other.serverUrl === origin.serverUrl)
    return earlier === undefined
      ? []
      : [
          `${origin.path}/package.json ploaness.serverUrl: is "${origin.serverUrl}", which ` +
            `${earlier.path} already drives; the end-to-end run would reuse that application's ` +
            'server and sweep the wrong one',
        ]
  })
