# Working Spyret → Spytial → Spyret round trip

This experiment tests the **working relationalizer and reifier** against the
particular Pyret runtime loaded by Spyret's editor. It does not introduce a
replacement relationalizer, a new relational encoding, or a direct string
decoder. The previous experimental constructor-data adapter has been removed.
Both this suite and the broader `reify-fidelity` suite now use the same
[`../pyret-round-trip/harness.js`](../pyret-round-trip/harness.js). Their corpora
differ; their production calls, JSON normalization, and isolation rules do not.

## The property under test

```text
same live Pyret value ── torepr ─────────────────────────────────── A
                     └─ PyretDataInstance ── serialized datum
                        └─ JSONDataInstance ── core reify ── expression
                           └─ fresh Pyret interactions ── torepr ── B

Pyret check: B is A
```

The producer evaluates the input expression once. Its reference string uses
the runtime's `_torepr` printer, the implementation behind `torepr`. It then
calls `new PyretDataInstance(value, {}, window.__internalRepl)`, exactly as
`src/web/js/trove/dom-render.js` does. There is no primitive-root wrapper or
test-specific structural conversion. The tests exercise these core calls in
the editor runtime, not the graphical layout/rendering UI.

Only JSON `atoms`, `relations`, and `types` cross to a separate editor page.
The decoder resets its interactions to `nothing` and clears the core's global
constructor cache before reification. It constructs a `JSONDataInstance` with
default normalization, then applies the working `PyretDataInstance` reifier to
that fresh datum. The explicit `PDI.prototype.reify.call(fresh)` selects the
same core class whose cache was cleared; editor bundles can expose more than
one copy. No producer value, original expression, reference string, declaration
schema, or seeded field-order cache is passed to this call.

**Only after the reifier has returned its expression** are the original
datatype declarations loaded into fresh decoder interactions, so Pyret can
evaluate that expression. Declarations cannot supply missing reconstruction
metadata. A browser regression poisons the constructor cache to check that
it is actually cleared.

After obtaining both strings, the harness runs an actual Pyret `check` block
containing `B is A`, with the strings encoded as escaped literals. It requires
exactly one check block, one test result, and no block errors. A successful
evaluation with missing checks is not a pass. Tests cover both successful and
deliberately failing checks. JavaScript exact equality also cross-checks the
Pyret result.

This measures textual inspection fidelity, not identity preservation or full
behavioral equivalence. Extra structure in the datum is allowed. A failed
round trip identifies a gap in this working pair; by itself it does not prove
that no other reifier could recover the string from that datum.

## Precisely scoped values

The **target domain**, not a claim of current support, is finite, immutable,
acyclic values built from:

```text
V ::= Integer(n)                         -2^31 <= n <= 2^31 - 1, exact
    | String(s)                          finite UTF-16 strings
    | Boolean(b)
    | Singleton(constructor-name)
    | Constructor(constructor-name, ordered immutable fields of V)
```

Constructor values use Pyret's default data printer. Singleton `zero` and
zero-argument application `zero()` are distinct. Recursive, mutually recursive,
and parameterized datatype declarations are included; each tested value must
be finite. Shared subvalues are allowed. Ordinary attached methods are allowed
because default data printing does not print them.

Outside this experiment: custom `_output`, mutable fields/references, cycles,
plain objects, tuples, arrays, functions as values or fields, `nothing`,
fractions, roughnums, and larger integers. User-defined default-printed `Chain`
values are included; built-in lists with custom printing are not. These are
experiment boundaries, not rejection guarantees provided by the working core.

The **default finite experiment** is the 33 named fixtures in `corpus.js`:

- Eight primitive roots: zero, both integer endpoints, both booleans, empty
  string, an escaping string, and a Unicode/control-character string.
- Singleton and zero-argument constructors; boxed primitive values including
  both integer endpoints and escaping/Unicode strings; distinct leaf types;
  argument order deliberately different from alphabetical field order; repeated
  equal arguments; an additional constructor; and an ordinary attached method.
- Base and recursive `Tree`, a recursive `Expr`, base/integer/string `Chain`,
  mutually recursive `Rose`/`Forest`, and shared versus equal-distinct subtrees.
- Unicode source normalization at the root and in a field (including a
  combining sequence and an unpaired surrogate), and identically named fields
  at different positions in two constructors within one datum.

The optional generated experiment adds deterministic `fast-check` samples:

- Five families: `Tree` (depth 4), `Expr` (depth 3), string `Chain` (length 0–6),
  `Rose`/`Forest` (rose depth 3, 0–3 children), and primitives. Generated strings
  have 0–12 arbitrary UTF-16 code units; generated integers span the domain.
- Generated datatype declarations each have a singleton, a zero-argument
  constructor, and 1–4 further variants of arity 1–4. Fields have `Number`,
  `String`, `Boolean`, or self-recursive types. Every variant gets a witness,
  plus sampled values of depth at most 3. These use integers -999..999 and
  three fixed string literals.

All fixture IDs and expressions are planned before execution. This is bounded,
seeded sampling, **not a shrinking property test or proof for arbitrary inductive
datatypes**. Missing samples cannot be replaced by successful shrink attempts.

## Running and interpreting the tests

```bash
# Strict measurement: exits nonzero on ANY fidelity gap or incomplete run
npm run constructor-data-report

# Fixed regression suite: all 33 fixtures must match on released core 6.0.0
npm run test:constructor-data

# Report validity and harness sequencing without a browser
npm run test:constructor-data:unit

# Optional larger strict measurement (samples per family and per schema)
CONSTRUCTOR_RUNS=30 CONSTRUCTOR_SCHEMAS=10 CONSTRUCTOR_SEED=1 npm run constructor-data-report

# Measure a locally built core without publishing it or changing editor pins
SPYTIAL_CORE_DIST=/absolute/path/to/spytial-core/dist npm run constructor-data-report
```

The browser commands require built `build/web`, Chrome/Chromium, and access to
the editor's pinned Spytial bundles. `BASE_URL`, `PORT`, `CHROME_BINARY`, and
`SHOW_BROWSER` reuse the [older harness's settings](../reify-fidelity/README.md).
On Apple Silicon use native ARM Node/Chrome, avoiding slow Rosetta emulation.

The strict command defaults to `CONSTRUCTOR_RUNS=0`, `CONSTRUCTOR_SCHEMAS=0`,
and `CONSTRUCTOR_SEED=1`. The regression suite always uses the fixed 33 cases.
`CONSTRUCTOR_REPORT` overrides `build/constructor-data-report.json` in either
command. Reports are generated artifacts, not committed fixtures.

`SPYTIAL_CORE_DIST` requires both the browser and components builds. It serves
those local JS/CSS bytes in place of the editor's core CDN requests in both
pages. Missing files are fatal; the Pyret runtime is not replaced. Reports
record the override directory, actual exported core version, and fingerprints
of the bytes served (the request URLs still reflect the editor's production
pins). Use the strict measurement when checking a new core implementation.
The corpus is identical with and without this optional development override.
Normal runs use the published assets directly, and verify that the bundle's
exported version agrees with the editor's CDN pin.

Reports retain the manifest, source expressions and declarations, A/B strings,
reified expressions, exported/received data, failure stages, environment
versions, and URLs/SHA-256 fingerprints of the deployed runtime/core artifacts.
Empty runs, missing/duplicate/unexpected IDs, initialization errors, and run
errors cannot report `fidelityHolds: true`. `complete: true` means the planned
measurement finished, not that its values all round-tripped.

## Pull-request CI

The [Pyret constructor round trips workflow](../../.github/workflows/constructor-data.yml)
runs on every pull request, pushes to `main`, and manual dispatch. Its two
independent jobs run the strict measurement with seed 1 (10 samples per family
and schema, 5 schemas) and seed 2 (3 samples, 2 schemas). Both include the 33
fixed witnesses. A mismatch, incomplete report, build failure, or
timeout fails the job; neither job uses the known-gap regression baseline as
its fidelity criterion.

CI installs the IDE's lockfile and builds its actual Pyret runtime. It then
loads the **released spytial-core 6.0.0** browser/component JS and CSS directly
from the editor's production CDN URLs. There is no core source checkout,
local build, or `SPYTIAL_CORE_DIST` override in CI. The fixed regression suite
also runs, including poisoned-cache and graph-rendering checks; a unit test
keeps all three asset pins aligned with the tested release. The older broader
suite runs implemented desired-behavior tests and visibly lists pending
requirements for the remaining Pyret forms. It never counts a known failure
as a passing assertion.

Jobs use Node 22.22.2 and the Ubuntu 24.04 runner's installed Chrome. Each job
uploads a `constructor-data-seed-N` artifact for 14 days, including the JSON
reports, measurement/regression logs, and IDE/Pyret revision, core asset URLs,
and browser provenance.
The report contains the actual served runtime/core fingerprints. Uploads run
even after failures; failures before measurement may have only provenance,
with setup/build details in the Actions log. No deployment credentials are
needed, and the workflow token has read-only repository access.

The checks run automatically, but making them mandatory for merging is a
separate repository branch-protection/ruleset setting.

## Historical 4.4.3 baseline

Before the production upgrade, with spytial-core **4.4.3**, Node 22.22.2,
and Chrome 152, the original 30 fixtures measured:

| Outcome | Fixed fixtures |
| --- | ---: |
| Exact inspection match | 12 |
| Different inspection strings | 8 |
| Relationalization error | 5 |
| Reified expression fails in Pyret | 5 |

That report said **`fidelityHolds: false`** and the strict command exited 1.
The old regression tests passed by asserting those failures, not fidelity.
The current 6.0.0 regression suite instead requires every fixture to pass.

A seed-1 smoke run with `CONSTRUCTOR_RUNS=2 CONSTRUCTOR_SCHEMAS=2` measured
53 fixtures: 18 exact matches, 13 mismatches, 7 relationalization errors, and
15 reified-expression errors. It completed without missing cases or harness
errors and correctly exited 1. The combined constructor-data and older
reify-fidelity regression suites passed 111 tests.

Concrete witnesses include `duo(9, 2)` becoming `duo(2, 9)`, `zero()` becoming
the constructor function `zero`, recursive tree arguments moving to the wrong
positions, and primitive-root failures (`true` throws; `0` becomes `nothing`).
Core 6.0.0 fixes these in the working pair, without repairing metadata in tests.

The historical `test/reify-fidelity` experiment supplied fixed constructor-field
metadata and adapted primitive roots, so its older match count answered a
different question. That path has now been removed; both current suites use
the shared datum-only harness.

## Released core 6.0.0 verification

With the production CDN pins set to 6.0.0 and no local-core override, the
combined constructor-data and broader reify-fidelity suites check implemented
behavior and explicitly list pending requirements.
All **33/33** fixed constructor fixtures match exactly. The suite also checks
poisoned-cache replay and graph rendering. The broader suite, on that same harness,
retains executable desired-success tests for missing behavior as pending; its
green status is not a claim of fidelity for all Pyret values. Seeded release
measurements run in PR CI and
upload their complete reports and served-artifact fingerprints.

## Pre-release core 6.0.0 verification

Against the locally built identity-preserving core (not the production CDN pin):

- Seed 1, `CONSTRUCTOR_RUNS=10 CONSTRUCTOR_SCHEMAS=5`: **154/154 exact matches**.
- Seed 2, `CONSTRUCTOR_RUNS=3 CONSTRUCTOR_SCHEMAS=2`: **63/63 exact matches**.
- Both strict commands completed with `fidelityHolds: true` and exit code 0.
- At that time, the pinned-4.4.3 regression suites passed 111 tests, retaining
  their documented known-gap outcomes.

These runs use the same runtime/JSON/reification/Pyret-check path, with no
constructor cache passed to the reifier. The new core preserves positions in
relation IDs and constructor arity in atom metadata. Generated tests also
exposed Pyret source normalization of literal Unicode (U+FAAA to U+7740); the
core now emits code-unit escapes so reconstruction preserves the string.
This verifies the recorded finite samples, not every Pyret datatype or printer.
