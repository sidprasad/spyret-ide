# Working Spyret → Spytial → Spyret round trip

This experiment tests the **working relationalizer and reifier** against the
particular Pyret runtime loaded by Spyret's editor. It does not introduce a
replacement relationalizer, a new relational encoding, or a direct string
decoder. The previous experimental constructor-data adapter has been removed.

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

The **default finite experiment** is the 30 named fixtures in `corpus.js`:

- Eight primitive roots: zero, both integer endpoints, both booleans, empty
  string, an escaping string, and a Unicode/control-character string.
- Singleton and zero-argument constructors; boxed primitive values including
  both integer endpoints and escaping/Unicode strings; distinct leaf types;
  argument order deliberately different from alphabetical field order; repeated
  equal arguments; an additional constructor; and an ordinary attached method.
- Base and recursive `Tree`, a recursive `Expr`, base/integer/string `Chain`,
  mutually recursive `Rose`/`Forest`, and shared versus equal-distinct subtrees.

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

# Regression suite: checks the recorded core-4.4.3 outcomes, including gaps
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
and `CONSTRUCTOR_SEED=1`. The regression suite always uses the fixed 30 cases.
`CONSTRUCTOR_REPORT` overrides `build/constructor-data-report.json` in either
command. Reports are generated artifacts, not committed fixtures.

`SPYTIAL_CORE_DIST` requires both the browser and components builds. It serves
those local JS/CSS bytes in place of the editor's core CDN requests in both
pages. Missing files are fatal; the Pyret runtime is not replaced. Reports
record the override directory, actual exported core version, and fingerprints
of the bytes served (the request URLs still reflect the editor's production
pins). Use the strict measurement, not the fixed-4.4.3 regression baseline,
when checking a new core implementation.

Local-core runs also add three fixed regression witnesses: Unicode source
normalization at the root and in a field (including an unpaired surrogate),
and two constructors whose identically named `value` fields occupy different
positions in the same datum. Thus local runs start with 33 fixed cases.

Reports retain the manifest, source expressions and declarations, A/B strings,
reified expressions, exported/received data, failure stages, environment
versions, and URLs/SHA-256 fingerprints of the deployed runtime/core artifacts.
Empty runs, missing/duplicate/unexpected IDs, initialization errors, and run
errors cannot report `fidelityHolds: true`. `complete: true` means the planned
measurement finished, not that its values all round-tripped.

## Measured baseline

With the editor's pinned spytial-core **4.4.3**, Node 22.22.2, and Chrome 152:

| Outcome | Fixed fixtures |
| --- | ---: |
| Exact inspection match | 12 |
| Different inspection strings | 8 |
| Relationalization error | 5 |
| Reified expression fails in Pyret | 5 |

Thus the report says **`fidelityHolds: false`** and the strict command exits 1.
The regression tests pass only because they explicitly assert these observed
outcomes; their green status must not be presented as validation of the domain.
A core upgrade requires remeasurement and deliberate baseline changes.

A seed-1 smoke run with `CONSTRUCTOR_RUNS=2 CONSTRUCTOR_SCHEMAS=2` measured
53 fixtures: 18 exact matches, 13 mismatches, 7 relationalization errors, and
15 reified-expression errors. It completed without missing cases or harness
errors and correctly exited 1. The combined constructor-data and older
reify-fidelity regression suites passed 111 tests.

Concrete witnesses include `duo(9, 2)` becoming `duo(2, 9)`, `zero()` becoming
the constructor function `zero`, recursive tree arguments moving to the wrong
positions, and primitive-root failures (`true` throws; `0` becomes `nothing`).
The next implementation step is to fix these in the working core pair and
rerun this same real-Pyret experiment, without repairing metadata in the tests.

The older `test/reify-fidelity` experiment remains available. It supplies fixed
constructor-field metadata and adapts primitive roots, so its higher match
count answers a different question and is not comparable to this datum-only
reification experiment.

## Local core 6.0.0 verification

Against the locally built identity-preserving core (not the production CDN pin):

- Seed 1, `CONSTRUCTOR_RUNS=10 CONSTRUCTOR_SCHEMAS=5`: **154/154 exact matches**.
- Seed 2, `CONSTRUCTOR_RUNS=3 CONSTRUCTOR_SCHEMAS=2`: **63/63 exact matches**.
- Both strict commands completed with `fidelityHolds: true` and exit code 0.
- The unchanged pinned-4.4.3 regression suites still pass 111 tests, retaining
  their documented known-gap outcomes. They have not been upgraded silently.

These runs use the same runtime/JSON/reification/Pyret-check path, with no
constructor cache passed to the reifier. The new core preserves positions in
relation IDs and constructor arity in atom metadata. Generated tests also
exposed Pyret source normalization of literal Unicode (U+FAAA to U+7740); the
core now emits code-unit escapes so reconstruction preserves the string.
This verifies the recorded finite samples, not every Pyret datatype or printer.
