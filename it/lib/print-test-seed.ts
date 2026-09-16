import { DETERMINISTIC_SEQUENCE } from '@ploaness/config/vitest-core'

process.stdout.write(`Running tests with seed "${String(DETERMINISTIC_SEQUENCE.seed)}"\n`)
