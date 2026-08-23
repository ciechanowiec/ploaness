// `ploaness init`: write the wiring a consumer needs, so adopting the harness is two commands rather
// than a page of copied configuration. Nothing here is magic: every file it writes is one the wiring
// gate will afterwards require, and it never overwrites a file that already exists.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  REQUIRED_BIOME_EXTENDS,
  REQUIRED_SCRIPTS,
  REQUIRED_TSCONFIG_EXTENDS,
  REQUIRED_TSCONFIG_PATHS,
  requiredBiomeFiles,
} from '@ploaness/governance'
import { seedIfMissing } from '../checks/assets.js'
import type { Context } from '../context.js'
import { sync } from './sync.js'

const ESLINT_STUB: string = `import ploaness from 'ploaness/eslint'

export default ploaness
`

// Biome resolves a relative glob against the config that declares it, so the file-selection block has to
// sit at the project root even though ploaness owns its contents. The wiring gate enforces it verbatim.
const biomeStub = (sourceRoots: readonly string[]): string =>
  `${JSON.stringify(
    { extends: [REQUIRED_BIOME_EXTENDS], files: requiredBiomeFiles(sourceRoots) },
    null,
    2,
  )}\n`

const TSCONFIG_STUB: string = `${JSON.stringify(
  {
    extends: REQUIRED_TSCONFIG_EXTENDS,
    compilerOptions: {
      paths: { '@/*': ['./src/*'], '@payload-config': ['./src/payload.config.ts'] },
    },
    ...REQUIRED_TSCONFIG_PATHS,
  },
  null,
  2,
)}\n`

const VITEST_STUB: string = `import ploaness from 'ploaness/vitest'\n\nexport default ploaness\n`

const stubs = (context: Context): Readonly<Record<string, string>> => ({
  'eslint.config.mjs': ESLINT_STUB,
  'biome.json': biomeStub(context.settings.sourceRoots),
  'tsconfig.json': TSCONFIG_STUB,
  'vitest.config.mts': VITEST_STUB,
})

const patchPackageJson = (context: Context): readonly string[] => {
  const file: string = path.join(context.root, 'package.json')
  if (!existsSync(file)) {
    return ['package.json is missing, so the scripts were not written']
  }
  const parsed: Record<string, unknown> = JSON.parse(readFileSync(file, 'utf8')) as Record<
    string,
    unknown
  >
  const scripts: Record<string, unknown> = {
    ...(parsed['scripts'] as Record<string, unknown> | undefined),
    ...REQUIRED_SCRIPTS,
  }
  const updated: Record<string, unknown> = { ...parsed, scripts }
  writeFileSync(file, `${JSON.stringify(updated, null, 2)}\n`)
  return ['package.json: wrote the ploaness scripts']
}

/** Scaffold the consumer-side wiring and materialise the managed files. */
export const init = (context: Context): number => {
  const notes: string[] = [...patchPackageJson(context)]
  for (const [file, body] of Object.entries(stubs(context))) {
    notes.push(
      seedIfMissing(context, file, body)
        ? `${file}: written`
        : `${file}: left alone because it already exists`,
    )
  }
  for (const note of notes) {
    console.info(`  ${note}`)
  }
  sync(context)
  console.info(
    '\nReview every change, then run `pnpm install` followed by `ploaness verify`. A pre-existing\nconfig was not overwritten: replace its contents with the ploaness stub yourself.',
  )
  return 0
}
