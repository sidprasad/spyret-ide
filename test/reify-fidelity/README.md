# Pyret inspection fidelity

This harness asks whether the existing Pyret importer preserves enough
information to reproduce `torepr(v)` for a declared corpus, given fixed
language/type definitions. It measures this decoder:

```
producer page: value -> torepr -----------------------------------------> A
producer page: value -> PyretDataInstance -> JSON datum
                                                |
decoder page:                                   v
                       JSONDataInstance -> core reify -> eval -> torepr -> B
```

The decoder page receives only the serialized datum. It never receives the
input expression, A, the original value, `originalObjects`, or a constructor
cache from the producer. Every decode creates a fresh `JSONDataInstance`.
The producer's constructor cache is cleared after export; the decoder's
cache is reset on every decode.

## Fixed decoder context

`PRELUDE` and `CONSTRUCTOR_FIELDS` in `corpus.js` are fixed before testing.
They declare the available types, constructor field order, and methods.
The latter supplies the ordering required by core's reification code: for example,
`node(v, l, r)` must not silently become `node(l, r, v)` through alphabetical
sorting. No constructor metadata is learned from an individual test value.
Both the prelude and schema are included in each JSON report.

The harness registers this schema through synthetic zero-valued records,
then invokes `PyretDataInstance.prototype.reify.call(freshJsonInstance)`.
Using that class's method keeps the schema cache and reification code in
the same core bundle instance; the editor's component integration can
install a second core copy. The method reads the fresh JSON instance's
atoms and relations, never a `PyretDataInstance` holding the source value.

The precise property is `decode(import(v), context) === torepr(v)` for the
tested subset and this fixed context. Reusing a type's `_output` method in
the decoder is permitted by that context; its code is not recovered from
the datum. Bare constructor names must be unambiguous and bound in the
prelude. Locally defined constructors, name collisions across modules,
closures capturing per-value state, and effectful or nondeterministic
`_output` methods are outside the supported subset.

The importer currently consumes raw runtime fields (`dict`, `brands`,
`$name`), **not value skeletons**. Pyret consults `_output` skeletons when
computing `torepr` on either path. This evaluates the current importer; it
does not establish fidelity for a future value-skeleton-based importer.
The reference output is specifically `torepr`, not every graphical REPL
renderer or the distinct command-line `$cli` renderer.

Primitive roots use the single-atom adapter also used by core's Pyret
oracles/`fromExpression`; the IDE's direct `genlayout` constructor path does
not handle primitive roots. Primitive results therefore describe that
adapter, not an end-to-end `genlayout` test.

## Running

```bash
npm run test:reify-fidelity
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

The CLI also accepts `--out`, `--fuzz`, `--seed`, and `--quiet`. Mocha shrinks
failing generated examples; the CLI samples without shrinking. Reports
retain all exported data, A/R/B strings, exact expected failure stages,
decoder context, seed, and core version. A partial or empty run cannot
report that the expected boundary holds.

## What counts as evidence

The 65 corpus rows exercise numbers, strings, booleans, `nothing`, data,
objects, tuples, raw arrays, refs, functions, `_output`, sharing, and
multiplicity. They are representative examples, not exhaustive coverage
of all values or every printer dispatch. The generator searches recursive
combinations of the declared supported forms.

- `supported`: exact equality of A and B is required.
- `unsupported`: the declared `mismatch` or `reify-eval-error` is required.
  Unexpected success or a different failure stage fails the suite.
- `value-error`, `relationalize-error`, and `decode-error` always fail the
  evaluation; they cannot be treated as expected unsupported behavior.

The aggregate assertion runs after the corpus and generated suites, checks
their completeness, and reports the actual fidelity rates. A green test
suite means the expected successes and failures were observed; it does not
mean that every corpus value round-tripped.

A reconstruction failure alone does not prove that information is missing:
another decoder could succeed. The suite additionally tests two actual
information-loss witnesses: `nothing` versus `{}`, and
`box([raw-array: 1])` versus `box([raw-array: 1, 1])`. Each pair exports
identical JSON data but has distinct `torepr` strings. No decoder receiving
only that datum and the same fixed context can distinguish the pair.

An isolation regression also poisons the decoder's constructor cache and
reorders relation records before replaying an exported `node` datum.

## Verified boundary on spytial-core 4.4.3

37 supported corpus rows cover small integers, strings, booleans, the
declared data variants and deterministic `_output` methods, option/either,
lists, shared subtrees, and repeated values under named fields. The other
28 rows fail the current reconstruction path.

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
