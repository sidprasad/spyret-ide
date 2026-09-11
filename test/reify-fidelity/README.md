# Reify fidelity (Pyret leg of the cross-language evaluation)

One question, asked once per host language: does the Spytial datum say enough
to reproduce the language's own inspection output for a value? For Pyret the
inspection output is `torepr`, the string the REPL echoes, and the two paths
compared are

```
value ── torepr ──────────────────────────────────────────────────► string   (A)
value ── PyretDataInstance ─► datum ─► reify() ─► eval ─► torepr ──► string   (B)
```

`reify()` is spytial-core's rendering of a datum back to Pyret constructor
notation. The harness evaluates that source in the IDE's own REPL and lets
Pyret's `torepr` print the result, the same shape as the Python leg
(`repr(reify(build_instance(v)))`) and the Rust leg
(`format!("{:?}", from_datum(export(v)))`). Whatever `torepr` recovers on the
way back is credited to the datum: a `link` chain prints as `[list: ...]`, a
custom `_output` method fires again.

The spytial-core repository carries the self-contained Tier A oracles
(`tests/pyret/`: fixed point of relationalize ∘ reify, and injectivity). This
directory is the Tier B harness those tests defer to: it needs a live Pyret
runtime, so it drives the real IDE.

## Running

```bash
npm run test:reify-fidelity        # mocha suite, shrinks a failing generated value
npm run reify-fidelity-report      # same cases without mocha; writes the JSON report
```

Requirements: a Chrome or Chromium binary (autodetected, or `CHROME_BINARY`),
network access to the spytial-core CDN the editor loads, and a built
`build/web`. The IDE server is started automatically with a local-only
environment (no Google credentials, no redis); set `BASE_URL` to use a server
you already have running.

| Variable | Meaning |
|---|---|
| `BASE_URL` | existing IDE to drive instead of starting one |
| `PORT` | port for the auto-started server (default 4999) |
| `CHROME_BINARY` | path to Chrome/Chromium |
| `SHOW_BROWSER` | run Chrome headed |
| `REIFY_FUZZ_RUNS` | generated values to try (default 100) |
| `REIFY_SEED` | fast-check seed, to reproduce a run |
| `REIFY_REPORT` | JSON report path (default `build/reify-fidelity-report.json`) |

Each case costs two REPL interactions, roughly 20 ms; the whole suite runs in
well under a minute.

## What is measured

`corpus.js` has one row per Pyret value form, keyed to the runtime's own
`torepr` dispatch: numbers, strings, booleans, `nothing`, data variants, plain
objects, tuples, raw arrays, refs, functions, and value-skeleton (`_output`)
values such as lists, sets, string-dicts and tables; plus sharing and
multiplicity rows. Every row carries its expected verdict, so the suite pins
the boundary of what the relational model reproduces:

- **supported**: A equals B. Must pass.
- **unsupported**: `torepr` is deterministic, but the datum or `reify` does not
  reproduce it today. Strict: if the row starts passing, the suite fails and
  the row must be promoted. The row's note says where the loss is.
- **out-of-scope**: `torepr` is not a function of the value alone. Skipped.
  (Currently empty: Pyret's `torepr` never prints identities.)

`arbitraries(fc)` is a fast-check generator over the supported forms only,
nested to depth four, so the property `A == B` is searched rather than only
tabulated. Verdicts per case are `pass`, `mismatch` (A and B differ),
`reify-eval-error` (R is not evaluable Pyret), `relationalize-error`, and
`value-error` (the corpus expression itself failed: a corpus bug).

## Current boundary (spytial-core 4.4.3)

Round-trips: fixnums, strings (including escapes and non-ASCII), booleans,
data variants including singletons, `with:`/`sharing:` methods and custom
`_output`, `some`/`none`/`left`/`right`, lists at any nesting, shared
subtrees, and duplicated numbers under named fields.

Does not round-trip, with the loss located:

| Form | Where the information goes |
|---|---|
| rationals, roughnums, big integers | jsnums objects are neither primitives nor Pyret objects: decimalised (`1/3` → `0.333…`) or dropped |
| `nothing` | a `PObject` with an empty dict; the datum cannot tell it from `{}` |
| plain objects | the datum holds the fields, but `reify` prints `PyretObject(1, 2)` rather than `{x: 1, y: 2}` |
| tuples | `PTuple` has `vals`, not `dict`; nothing is recorded |
| raw arrays | elements survive as relation tuples, but `reify` prints `[list: …]` and idempotent numbers collapse duplicates |
| `ref` fields, cycles | `PRef` has no `dict`; dropped. Cycles additionally need a `block:`-and-backpatch source form |
| functions | `<function>` is deterministic, but a `PFunction` has no `dict` |
| arity-0 constructors | `reify` prints `zero`, which evaluates to the constructor, not `zero()` |
| sets, string-dicts, tables | internal representations (AVL tree, opaque map, row relation) that are not source |

The first group is a datum-level loss (the relationalizer in spytial-core);
the object, raw-array and arity-0 rows are printer-level (the information is
in the datum and `reify` could emit it).
