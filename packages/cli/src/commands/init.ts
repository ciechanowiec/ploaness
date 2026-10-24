// Scaffold missing member configurations and scaffold files, then synchronize scripts and managed content.
import {
  type MemberKind,
  type MemberWiringTargets,
  memberKindOf,
  ROOT_MEMBER_PATH,
  requiredBiomeFiles,
  tsconfigPathsFor,
  VITEST_CONFIG_FILE,
  wiringTargetsFor,
} from '@ploaness/governance'
import { hasSeededFile, writeScaffolds } from '../checks/assets.js'
import type { Member, Repository } from '../context.js'
import { sync } from './sync.js'

// Every stub is rendered from the same table the wiring rule reads. Writing either side's literal by
// hand is what once scaffolded a project the gate then failed.
const reexportStub = (specifier: string): string => `import ploaness from '${specifier}'\n\nexport default ploaness\n`

// The indent every JSON file ploaness writes uses, matching the shipped formatter setting.
const JSON_INDENT: number = 2

// Biome resolves a relative glob against the config that declares it, so the file-selection block has to
// sit at each member's root even though ploaness owns its contents. The wiring gate enforces it verbatim.
const biomeStub = (member: Member, kind: MemberKind, targets: MemberWiringTargets): string =>
  `${JSON.stringify(
    {
      // A nested configuration has to say it is not a root, or Biome refuses the whole tree.
      ...(member.path !== ROOT_MEMBER_PATH && { root: false }),
      extends: [targets.biomeExtends],
      files: requiredBiomeFiles(member.settings.sourceRoots, kind, member.settings.generatedArtefacts),
    },
    null,
    JSON_INDENT,
  )}\n`

// Only a Payload member has a Payload config to alias. The rest of the map is the project's own, which
// is why `paths` is one of the few compiler options a member may set for itself.
const pathAliases = (kind: MemberKind): Readonly<Record<string, readonly string[]>> =>
  kind === 'payload' ? { '@/*': ['./src/*'], '@payload-config': ['./src/payload.config.ts'] } : { '@/*': ['./src/*'] }

const tsconfigStub = (kind: MemberKind, targets: MemberWiringTargets, nestedMembers: readonly string[]): string =>
  `${JSON.stringify(
    {
      extends: targets.tsconfigExtends,
      compilerOptions: { paths: pathAliases(kind) },
      ...tsconfigPathsFor(targets.tsconfigPaths, nestedMembers),
    },
    null,
    JSON_INDENT,
  )}\n`

const stubs = (member: Member): Readonly<Record<string, string>> => {
  const kind: MemberKind = memberKindOf(member.packageJson)
  const targets: MemberWiringTargets = wiringTargetsFor(kind)
  return {
    'eslint.config.mjs': reexportStub(targets.eslintSpecifier),
    'biome.json': biomeStub(member, kind, targets),
    'tsconfig.json': tsconfigStub(kind, targets, member.siblingPaths),
    [VITEST_CONFIG_FILE]: reexportStub(targets.vitestSpecifier),
    // A member with no application is not given a browser configuration, because the rule does not ask
    // it for one.
    ...(targets.playwrightSpecifier !== undefined && {
      'playwright.config.ts': reexportStub(targets.playwrightSpecifier),
    }),
  }
}

const memberNotes = (member: Member, isSolo: boolean): readonly string[] => {
  const label: string = isSolo || member.path === ROOT_MEMBER_PATH ? '' : `${member.path}/`
  return Object.entries(stubs(member)).map(([file, body]: readonly [string, string]): string =>
    hasSeededFile(member.root, file, body)
      ? `${label}${file}: written`
      : `${label}${file}: left alone because it already exists`,
  )
}

/** Scaffold the consumer-side wiring and materialise the managed files. */
export const init = (repository: Repository): number => {
  const isSolo: boolean = repository.members.length <= 1
  const notes: readonly string[] = [
    ...repository.members.flatMap((member: Member): readonly string[] => memberNotes(member, isSolo)),
    ...writeScaffolds(repository).map(([file, isWritten]: readonly [string, boolean]): string =>
      isWritten ? `${file}: written` : `${file}: left alone because it already exists`,
    ),
  ]
  for (const note of notes) {
    console.info(`  ${note}`)
  }
  // `sync` writes the root scripts and the managed files, and merges the write denial into the runtime
  // settings. The scripts sit at the repository root only: `pnpm run verify` is invoked there and fans
  // out from there, so a copy inside every member would be several entry points to one run.
  const syncExit: number = sync(repository)
  if (syncExit !== 0) {
    return syncExit
  }
  console.info(
    '\nReview every change, then run `pnpm install` followed by `ploaness verify`. A pre-existing' +
      '\nconfig was not overwritten: replace its contents with the ploaness stub yourself.',
  )
  return 0
}
