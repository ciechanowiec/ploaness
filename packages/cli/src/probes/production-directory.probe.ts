// Loading project configuration can mutate process environment; keep it in this production child.
import { type ProductionBuild, readProductionBuild } from '@ploaness/config/production-build'
import { PRODUCTION_DIRECTORY_MARKER } from '@ploaness/governance'

const build: ProductionBuild = await readProductionBuild(process.cwd())
console.info(`${PRODUCTION_DIRECTORY_MARKER}${JSON.stringify(build.directory)}`)
