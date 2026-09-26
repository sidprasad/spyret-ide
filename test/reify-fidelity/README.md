# Pyret inspection fidelity

Current integration: the IDE's production diagrams use npm `spyret@0.1.1`
and released Core `6.3.2`. This suite still measures Core's retained legacy
Pyret APIs as a regression baseline; the production Spyret path is covered by
`test/relationalization/capture.test.js` and the client display tests. Results
below explicitly labeled 6.0.1 are historical measurements.

This suite asks whether the working Pyret relationalizer preserves enough
information to reproduce `torepr(v)` for a declared corpus. It uses the same
[`../pyret-round-trip/harness.js`](../pyret-round-trip/harness.js) as the strict
constructor suite, not a second adapter or decoder. Both measure:

```
producer page: value -> torepr -----------------------------------------> A
producer page: value -> PyretDataInstance -> JSON datum
                                                |
decoder page:                                   v
                       JSONDataInstance -> core reify -> eval -> torepr -> B
```

The reifier receives only the serialized datum and a separate root atom ID.
The producer selects its input atom before transport; root selection is not
metadata in `IDataInstance` and does not encode the value in an ID. The reifier
never receives the input expression, A, the original value, `originalObjects`, or a constructor
cache from the producer. Every decode creates a fresh `JSONDataInstance`.
The producer's constructor cache is cleared after export; the decoder's
cache is reset on every decode.

## Datum-only reification; declarations only for evaluation

Every case starts fresh producer interactions containing `PRELUDE`, then
evaluates the input expression once. Its live result is passed directly to
`new PyretDataInstance(value, {}, window.__internalRepl)`, exactly as in the
working diagram path, including primitive roots.

The decoder first resets its interactions to `nothing`. With constructor
caches cleared, it normalizes the serialized datum using
`new JSONDataInstance(datum)` with **default options**, then invokes
`PyretDataInstance.prototype.reify.call(freshJsonInstance, rootId)`. This selects the
same core class whose cache was cleared; the editor can load two core copies.

Only **after** that method has returned an expression does the decoder load
`PRELUDE`, evaluate the expression and obtain its `torepr` string. An actual
Pyret `check` must contain exactly one successful `B is A` result; JavaScript
string equality cross-checks it. The shared harness also records failures of
initialization, export, normalization/reification, evaluation, and checking.

There is no constructor-field schema, synthetic registration, primitive
wrapper, or alternative normalization mode. Constructor order and arity must
travel with the datum. Unit tests guard those boundaries; browser regressions
poison caches, rename/reorder atoms, reorder relations, and replay a datum after evaluating a
same-named constructor with a different field order.

`PRELUDE` supplies language/type definitions for evaluation, not metadata to
the reifier. Reusing a type's deterministic `_output` method there is permitted;
its code is not recovered from the datum. Public library constructors are included (`string-dict`, `tables`) for evaluation.
Bare constructor names must be
unambiguous and bound in the evaluation prelude. Locally scoped constructors,
name collisions across modules, closures capturing per-value state, and
effectful or nondeterministic `_output` methods remain outside the supported subset.

The importer currently consumes raw runtime fields (`dict`, `brands`,
`$name`), **not value skeletons**. Pyret consults `_output` skeletons when
computing `torepr` on either path. This evaluates the current importer; it
does not establish fidelity for a future value-skeleton-based importer.
The reference output is specifically `torepr`, not every graphical REPL
renderer or the distinct command-line `$cli` renderer.

The two suites now differ in their **corpora**, not their transport or decoder:
`constructor-data` samples the narrowly specified constructor domain, while
this suite includes built-in collections, custom printing, and pending forms.
The main round trips do not test graphical output. A separate smoke test invokes
Spyret’s actual `spytial` module on a cycle and checks that it displays both
reconstructed source and graph nodes.

## Running

```bash
npm run test:reify-fidelity
# Run the executable pending specifications while implementing missing support
REIFY_INCLUDE_PENDING=1 npm run test:reify-fidelity
# Measure every case, including pending ones; any fidelity gap exits nonzero
npm run reify-fidelity-report
```

Requires a Chrome/Chromium binary, a built `build/web`, and network access to
the editor's pinned spytial-core CDN bundles. The harness starts a local
server unless `BASE_URL` is supplied or an editor is already running on
`PORT`. Two separate editor pages host the producer and decoder.

| Variable | Meaning |
|---|---|
| `BASE_URL` | Existing IDE to drive |
| `PORT` | Local server port (default 4999) |
| `CHROME_BINARY` | Chrome/Chromium executable |
| `SHOW_BROWSER` | Show the browser |
| `REIFY_FUZZ_RUNS` | Positive number of generated tests (default 100) |
| `REIFY_SEED` | Integer fast-check seed (default 1) |
| `REIFY_REPORT` | JSON report path (default `build/reify-fidelity-report.json`) |
| `REIFY_INCLUDE_PENDING` | Set to `1` to execute pending desired-behavior tests (Mocha) |

The CLI also accepts `--out`, `--fuzz`, `--seed`, and `--quiet`. Mocha shrinks
failing generated examples; the CLI samples without shrinking. Reports
retain exported and normalized data, A/R/B strings, actual Pyret check results,
failure stages, desired outcomes, evaluation declarations, seed, and core version.
Both include `protocol: "spyret-datum-root-v2"`, the separately selected `rootId`,
and fingerprints of the actual served Pyret bundle and all three core JS/CSS assets. `evaluationContext` replaces the old `decoderContext`
report field: no constructor schema is supplied. A partial or empty run cannot report
full fidelity. The CLI runs pending cases too and exits 1 for any gap; it does
not turn a previously observed failure into a passing test.

The PR workflow runs the enabled corpus and 100 generated broad values in each
job, with `REIFY_SEED` set to the job's seed (1 or 2), alongside the constructor
suite. Shared harness contract tests run before the Pyret build. Reports and logs,
including the list of pending requirements, are uploaded with each job's artifacts.

## What counts as evidence

The 88 corpus rows exercise numbers, strings, booleans, `nothing`, data,
objects, tuples, raw arrays, refs, functions, `_output`, sharing, and
multiplicity. They are representative examples, not exhaustive coverage
of all values or every printer dispatch. The generator searches recursive
combinations of the declared supported forms.

- Every in-scope case has `desiredVerdict: 'pass'`: exact equality of A and B.
- `supported` marks enabled regression tests for implemented behavior.
- `pending` marks executable specifications for missing behavior, skipped in
  normal CI and displayed as TODOs. Their test bodies assert success, not an
  expected mismatch or exception. Set `REIFY_INCLUDE_PENDING=1` to run them.
- Errors and mismatches always count as gaps when measured. A pending case
  beginning to round-trip is progress, never a failure of the specification.

The aggregate assertion checks completeness and success of enabled tests.
Reports distinguish `requiredChecksHold` from `fidelityHolds`: green enabled
checks do not imply that the full desired corpus is satisfied. Pending case
IDs and their desired expressions remain in the report manifest. Missing
enabled cases still fail; skipped pending cases never count as verified passes.

A reconstruction failure alone does not prove that information is missing:
another decoder could succeed. Two enabled tests require preserving
the distinction between `nothing` and `{}`, and between
`box([raw-array: 1])` and `box([raw-array: 1, 1])`. These pairs must have distinguishable exported data as well as distinct
`torepr` strings. Both requirements are now enforced.

An isolation regression also poisons the decoder's constructor cache and
reorders relation records before replaying an exported `node` datum.

## Released 6.0.1 coverage and remaining work

The original 65 fixture IDs are preserved. Of their 27 previously pending cases,
25 now run as required regressions: exact numbers, `nothing`, objects, tuples,
arrays, references/cycles, sets, dictionaries, and the table inspection marker.
There are also 23 new library/graph witnesses: **86 enabled inspection cases and
two pending function cases**, plus 100 generated values per seed.

The recursive generator combines exact/rational/rough/big numbers, strings,
booleans, `nothing`, constructors, lists/options/either, objects, tuples, arrays,
and dictionaries. Empty containers, repeated entries and shared nested values
are explicit branches. Separate bounded branches generate numeric list/tree
sets and initialized unrestricted reference rings of one to four cells.

The supported reference subset has a reachable mutable constructor-field owner
for each PRef. Arbitrary direct array/object cycles, uninitialized references,
and arbitrary reference annotations are not claimed. Functions remain blocked
on [core #596](https://github.com/sidprasad/spytial-core/issues/596). Standalone
Pyret Row values and function-valued table cells are outside this corpus.

### Additional table contents and behavior evidence

`observations.js` defines **16 separately reported observations: 15 enabled and
one pending**. They do not
increase the inspection pass count or change what exact `torepr` equality means:

- Seven table-content checks compare ordered headers and rows, including empty
  and zero-column tables, repeated rows, structured cells, nested tables and
  unusual header names.
- Four table-behavior checks cover shared-array mutation, a reference back to
  the table, a dictionary back to the table, and public table operations.
- Three reference-behavior checks distinguish shared from separate cells and
  check self/two-cell cycles and mutation through aliases.
- One enabled dictionary-behavior check exercises a cycle; shared-array mutation
  in an immutable dictionary is a pending stronger requirement.

Each first runs the ordinary round trip, then applies the same observation to
fresh original and reconstructed values. Observation code is supplied only
**after reification**. Their inspection strings are compared by a real Pyret
check; behavior witnesses also check the original against a declared result,
so two equally ineffective observations cannot establish the promised behavior.

Reports keep these in `assertions`, with their own manifest, per-category scores,
missing/pending IDs and failures. Missing required, duplicate or failed measured
observations fail the run even when all ordinary inspection strings match.
`requiredAssertionsHold` distinguishes enabled checks from the full
`assertionsHold` claim. The diagnostic CLI runs every pending case/observation;
it must exit nonzero while the two function gaps and dictionary behavior gap remain.

The dictionary witness is:

```pyret
block:
  a = [raw-array: 1]
  [string-dict: "a", a, "b", a]
end
```

Both `entry` tuples in its datum target **one RawArray atom**, so the relational
model preserves the sharing. Core 6.0.1 prints two array literals in this case.
Both dictionaries have identical `torepr` strings, but mutating the array under
key `"a"` changes the value under `"b"` only in the original. This is a core
source-emission limitation, not missing relational information. Its pending
observation requires alias preservation; it does not assert that the failure
should persist.

To promote a remaining case, fix the core implementation, run the unchanged
exact assertion against a released bundle, then mark it `supported`. Do not
change the assertion to expect its current failure.

## Historical boundary on spytial-core 4.4.3

These older measurements used a primitive-root adapter, a fixed
`CONSTRUCTOR_FIELDS` schema seeded into the decoder cache, and non-default JSON
normalization. That implementation has been removed. The results below describe
the old experiment and must not be presented as evidence for the current protocol.

37 supported corpus rows cover small integers, strings, booleans, the
declared data variants and deterministic `_output` methods, option/either,
lists, shared subtrees, and repeated values under named fields. The other
28 rows failed that reconstruction path.

Verified on 2026-09-11 with native ARM Node 22.22.2 and Chrome 152: all
37 supported corpus rows and 100 generated examples (seed 1) round-tripped.
The 28 unsupported rows produced 20 evaluation errors and 8 mismatches,
all at their declared stages. The complete Mocha suite passed 73 tests,
including cache isolation, both collision witnesses, and report validity.

| Form | Limitation of this importer/decoder pair |
|---|---|
| Rationals, roughnums, big integers | Dropped or converted to inexact JavaScript numbers |
| `nothing` | Collides with the empty object |
| Plain objects | Named fields survive in these examples; core emits constructor syntax instead of object syntax |
| Tuples | `vals` is not traversed |
| Raw arrays | Root contents are dropped; field arrays lack explicit positions/container tags and repeated tuples collapse |
| Refs and ref cycles | `PRef` contents are dropped |
| Functions | Roots and the tested function field become generic object atoms, losing the function tag |
| Arity-0 constructors | Core emits `zero` instead of `zero()`; the fixed prelude could support a better decoder |
| Sets | Constructor availability/calling convention prevents evaluation; failure alone is not evidence of datum loss |
| String dictionaries | Entries are hidden in an opaque map |
| Tables | The special row export and current source printer do not reconstruct the table; headers are not preserved as data |

These limits concern this concrete import/decoder implementation. They do
not establish a limitation of Spytial's relational model, which could encode
additional tags, ordered positions, and exact primitive representations.

On Apple Silicon, use a native ARM Node/Chrome installation. An Intel Node
can launch Chrome under Rosetta; this made Pyret initialization extremely
slow in local verification.
