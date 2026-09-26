# Pyret capture in Spyret-IDE

The diagram path now captures through [Spyret's portable Pyret API](https://github.com/sidprasad/spyret):

```text
live value + owning runtime
  -> capturePyret(named roots, runtime adapter)
  -> portable snapshot
  -> importPyretCapture(snapshot)
  -> existing layout and graph renderer
```

Capture uses no REPL, `_output`, custom skeleton, or DOM. The IDE uses the
unmodified upstream Pyret backend and a host display adapter; the same capture
library works in a headless process. The encoding, validation, and runtime adapter live
in Spyret, not in this repository.

The returned diagram container exposes `spytialCapture`, a detached,
JSON-serializable snapshot containing atoms/relations/types and an explicit
named root. A consumer calls `Spyret.importPyretCapture(snapshot)`
to obtain a data instance without the original value or runtime. The Spyret API
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

The IDE depends on published `spyret@0.1.1` through npm and its lockfile.
`make web` (also used by the static build) copies the package's browser entry
into `lib/js/spytial-pyret-capture.js` before serving it. The adjacent manifest
records the npm tarball URL/integrity and browser SHA-256; the licenses come
from the package. CI verifies that the checked-in asset exactly matches the
installed npm release. No Spyret or Core source checkout is used.

To update Spyret, run `npm install --ignore-scripts --save-exact spyret@VERSION`
and `npm run update:spyret`, then commit the manifests and browser assets.
The IDE currently uses published Core **6.3.2** for queries, layout, the graph
component and spec editor. All three CDN assets are pinned to that release.
Spyret supplies `prepareDiagram(value, runtime)` → `IDataInstance`; Core receives
that instance. The adapter integration requires no Core API changes or unpublished entry points.
Core 6.3.2 also fixes zoom-animation cleanup when a diagram is removed.

`npm run test:relationalization` checks the legacy baseline audit and the new
API. The new integration checks import all 86 enabled existing corpus examples
in a fresh headless realm, inspect dictionary sharing, check nested errors, and
invoke the real display module with the browser REPL global removed.
Both CI seeds also run the new capture path through 100 generated values and
20 generated datatype declarations (all variant witnesses plus generated values).
Reconstruction happens in the headless consumer; a separate Pyret runtime then
checks exact inspection equality. Set `REIFY_SEED` and `REIFY_FUZZ_RUNS` to replay
or expand the value PBTs. Spyret separately checks 2,000 generated graphs for
identity and topology preservation, which inspection equality alone cannot show.

Spyret additionally builds and tests upstream Pyret revision
`6e62dcda5298606aa0abe66a372c4eb17a38db85`: 23 real runtime roots imported in a
fresh Node process, ten unsupported-value diagnostics, and a compiled Pyret
program with same-named imported constructors, sharing, cycles and a throwing
printer. Its Node PBT suite also checks generated values and declarations
without loading Spyret-IDE.

The compiler is pinned to the upstream `drydock` revision above by the
`vendor/pyret-upstream` Git submodule. No source patches are applied. CI checks
out that submodule, builds the IDE with it, and runs both PBT seeds. Browser
tests explicitly require the fork-only `isVSConstrRender` hook to be absent.

## Displaying values on standard Pyret

```pyret
import spytial as SP
data Tree: leaf | node(value, left, right) end
SP.diagram(node(1, leaf, leaf), "")
```

`SP.diagram` wraps the rendered diagram in a standard Pyret opaque value. The IDE
recognizes only its own display handles and inserts their DOM into the output
pane. No compiler, runtime, FFI or ValueSkeleton extension is required. This
host adapter and its DOM nodes are separate from the portable capture snapshot.
The lower-level `SP.genlayout` remains available to JavaScript host callers.

Existing custom printers should replace `vs-constr-render` with the standard
`vs-value` variant:

```pyret
import spytial as SP
import valueskeleton as VS
data Box: box(n) with:
  method _output(self): VS.vs-value(SP.diagram(self, "")) end
end
box(42)
```

YAML specifications and the spec editor work with the same string literals.
The library captures declared state directly, so custom printing does not
re-enter `_output`. The static browser suite exercises both display forms through
the actual Run button. Other user-facing design work remains in the
[integration plan](spytial-library-plan.md).
The [original audit](relationalization-audit.md) records the losses that motivated
this implementation; its two legacy loss witnesses do not describe the new API.
