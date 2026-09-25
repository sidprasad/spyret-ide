# Pyret capture in Spyret-IDE

The diagram path now captures through Spytial-Core's portable Pyret API:

```text
live value + owning runtime
  -> capturePyret(named roots, runtime adapter)
  -> portable snapshot
  -> importPyretCapture(snapshot)
  -> existing layout and graph renderer
```

Capture uses no REPL, `_output`, custom skeleton, or DOM. The IDE's existing
display hook invokes it, but the same library works with standard Pyret in a
headless process. The capture API, encoding, validation, and runtime adapter live
in Spytial-Core, not in this repository.

The returned diagram container exposes `spytialCapture`, a detached,
JSON-serializable snapshot containing atoms/relations/types and an explicit
named root. A consumer calls `SpytialPyretCapture.importPyretCapture(snapshot)`
to obtain a data instance without the original value or runtime. The Core API
also accepts multiple named roots captured together, preserving aliases across
them, plus optional JSON observation/provenance metadata.

Constructor identities are distinct from their display names. Exact numbers,
declared field order, container positions, sharing and supported cycles survive
export/import. Unsupported functions/opaque values or reference states produce
an error with the root and field/index path; they do not silently disappear.
Datatype methods remain declaration behavior, outside the captured state.

The source preview is optional: a graph with ambiguous same-named constructors
or a cycle unsupported by the source emitter still renders. Importing the
snapshot reconstructs structure, not executable closures or datatype bindings.

## Dependency and verification

The independently built Core capture bundle is vendored in
`lib/js/spytial-pyret-capture.js`, with its source revision, SHA-256 and licenses
beside it. Regenerate it with `src/scripts/update-pyret-capture.js`. CI rebuilds
that exact Core revision and compares the asset. This allows capture to evolve
without upgrading the pinned Core 6.0.1 layout/UI bundles in the same change.

`npm run test:relationalization` checks the legacy baseline audit and the new
API. The new integration checks import all 86 enabled existing corpus examples
in a fresh headless realm, inspect dictionary sharing, check nested errors, and
invoke the real display module with the browser REPL global removed.

Core additionally builds and tests upstream Pyret revision
`6e62dcda5298606aa0abe66a372c4eb17a38db85`: 23 real runtime roots imported in a
fresh Node process, ten unsupported-value diagnostics, and a compiled Pyret
program with same-named imported constructors, sharing, cycles and a throwing
printer. The same runtime/program checks also pass against the current Spyret
fork.

The compiler dependency is intentionally unchanged. Removing the custom
display hook and switching the whole IDE to upstream Pyret remain the later
display migration in the [integration plan](spytial-library-plan.md).
The [original audit](relationalization-audit.md) records the losses that motivated
this implementation; its two legacy loss witnesses do not describe the new API.
