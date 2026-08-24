// Two specs assert properties over generated inputs rather than over enumerated examples, and their
// comments already said a fixed global seed kept them deterministic. It did not: no setup file existed,
// so fast-check drew a fresh seed on every run and those two gates could reach a different verdict on
// an unchanged repository. A check may not do that.
//
// The value itself carries no meaning. What matters is that it never changes, so a failure is
// reproducible by rerunning rather than by guessing which inputs the last run happened to draw.
import fc from 'fast-check'

const PROPERTY_TEST_SEED: number = 1_734_000_000

fc.configureGlobal({ seed: PROPERTY_TEST_SEED })
