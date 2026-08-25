// Two specs assert properties over generated inputs rather than over enumerated examples, and their
// comments already said a fixed global seed kept them deterministic. It did not: no setup file existed,
// so fast-check drew a fresh seed on every run and those two gates could reach a different verdict on
// an unchanged repository. A check may not do that.
//
// The value itself carries no meaning. What matters is that it never changes, so a failure is
// reproducible by rerunning rather than by guessing which inputs the last run happened to draw.
//
// The seed itself comes from `@ploaness/config/vitest-core`, which exists to own exactly this literal
// and said so in its own header - while nothing read the export and this file wrote the number out
// again. What has to stay HERE is the call: a setup file inside node_modules/@ploaness/config resolves
// its own copy of fast-check, so a global configured there would attach to a module the suite never
// loads. The constant travels; the call does not.
import { PROPERTY_TEST_SEED } from '@ploaness/config/vitest-core'
import fc from 'fast-check'

fc.configureGlobal({ seed: PROPERTY_TEST_SEED })
