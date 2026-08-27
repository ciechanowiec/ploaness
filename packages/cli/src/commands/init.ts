// `ploaness init`: write the wiring a consumer needs, so adopting the harness is two commands rather
// than a page of copied configuration. Nothing here is magic: every file it writes is one the wiring
// gate will afterwards require, and it never overwrites a file that already exists.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  asRecord,
  type MemberKind,
  type MemberWiringTargets,
  memberKindOf,
  type ParsedJson,
  parseJsonc,
  REQUIRED_SCRIPTS,
  ROOT_MEMBER_PATH,
  requiredBiomeFiles,
  wiringTargetsFor,
} from '@ploaness/governance'
import { hasSeededFile } from '../checks/assets.js'
import type { Member, Repository } from '../context.js'
import { sync } from './sync.js'

// Every stub is rendered from the same table the wiring rule reads. Writing either side's literal by
// hand is what once scaffolded a project the gate then failed.
const reexportStub = (specifier: string): string =>
  `import ploaness from '${specifier}'\n\nexport default ploaness\n`

// The indent every JSON file ploaness writes uses, matching the shipped formatter setting.
const JSON_INDENT: number = 2

// Biome resolves a relative glob against the config that declares it, so the file-selection block has to
// sit at each member's root even though ploaness owns its contents. The wiring gate enforces it verbatim.
const biomeStub = (
  sourceRoots: readonly string[],
  kind: MemberKind,
  targets: MemberWiringTargets,
): string =>
  `${JSON.stringify(
    { extends: [targets.biomeExtends], files: requiredBiomeFiles(sourceRoots, kind) },
    null,
    JSON_INDENT,
  )}\n`

// Only a Payload member has a Payload config to alias. The rest of the map is the project's own, which
// is why `paths` is one of the few compiler options a member may set for itself.
const pathAliases = (kind: MemberKind): Readonly<Record<string, readonly string[]>> =>
  kind === 'payload'
    ? { '@/*': ['./src/*'], '@payload-config': ['./src/payload.config.ts'] }
    : { '@/*': ['./src/*'] }

const tsconfigStub = (kind: MemberKind, targets: MemberWiringTargets): string =>
  `${JSON.stringify(
    {
      extends: targets.tsconfigExtends,
      compilerOptions: { paths: pathAliases(kind) },
      ...targets.tsconfigPaths,
    },
    null,
    JSON_INDENT,
  )}\n`

const stubs = (member: Member): Readonly<Record<string, string>> => {
  const kind: MemberKind = memberKindOf(member.packageJson)
  const targets: MemberWiringTargets = wiringTargetsFor(kind)
  return {
    'eslint.config.mjs': reexportStub(targets.eslintSpecifier),
    'biome.json': biomeStub(member.settings.sourceRoots, kind, targets),
    'tsconfig.json': tsconfigStub(kind, targets),
    'vitest.config.mts': reexportStub(targets.vitestSpecifier),
    // A member with no application is not given a browser configuration, because the rule does not ask
    // it for one.
    ...(targets.playwrightSpecifier !== undefined && {
      'playwright.config.ts': reexportStub(targets.playwrightSpecifier),
    }),
  }
}

const patchPackageJson = (repository: Repository): readonly string[] => {
  const file: string = path.join(repository.root, 'package.json')
  if (!existsSync(file)) {
    return ['package.json is missing, so the scripts were not written']
  }
  const read: ParsedJson = parseJsonc(readFileSync(file, 'utf8'))
  if (read.problem !== undefined) {
    return [`package.json is not valid JSON (${read.problem}), so the scripts were not written`]
  }
  const parsed: Record<string, unknown> = asRecord(read.value)
  const scripts: Record<string, unknown> = {
    ...asRecord(parsed['scripts']),
    ...REQUIRED_SCRIPTS,
  }
  const updated: Record<string, unknown> = { ...parsed, scripts }
  writeFileSync(file, `${JSON.stringify(updated, null, JSON_INDENT)}\n`)
  return ['package.json: wrote the ploaness scripts']
}

// The scripts are written once, at the repository root: `pnpm run verify` is invoked there and fans out
// from there, so a copy inside every member would be several entry points to one run.
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
    ...patchPackageJson(repository),
    ...repository.members.flatMap((member: Member): readonly string[] =>
      memberNotes(member, isSolo),
    ),
  ]
  for (const note of notes) {
    console.info(`  ${note}`)
  }
  // `sync` writes the managed files and merges the write denial into the runtime settings.
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
