# Relationalization boundary: measured baseline and first implementation

Status: historical stage-1 baseline, measured on 2026-09-25 before implementing
the new capture API. The proposed work below has now been implemented in
**Spytial-Core** and integrated in the IDE; see [the current integration](pyret-capture.md).
This audit is retained to explain the original losses and design decisions.

## Decision

Retain atoms, relations, and types as the authoritative value graph. The current
encoding already preserves most of the structural facts in the first scope.
Do not replace it with value skeletons or a parallel JSON object tree.

Add a small Core capture boundary with explicit roots, an explicit runtime
adapter, and a versioned export envelope. Before calling that boundary faithful,
fix nominal constructor identity and make unsupported-state losses explicit.
Neither fix requires redesigning `_output`, YAML, view attachment, or the host.

There is no reason to require an evaluator for capture: the measured constructor
invocation `new PyretDataInstance(value)` works. The current IDE passes the REPL
as a third argument, but capture does not use it. Evaluation is a separate
capability needed to obtain values from expressions or execute emitted source.

## Exact baseline

| Component | Inspected/measured version |
| --- | --- |
| IDE starting revision | `e5da0b7bf5f5e92fc29d6b92332f4abd11106d7c` |
| Compiler dependency | `sidprasad/spyret-lang#main`, lockfile resolves `6a6c8728f7540d36a143538f6068eb033849ed27` |
| Actual Core assets | All three editor assets pinned to npm `spytial-core@6.0.1` |
| Corresponding local Core tag | `v6.0.1`, commit `6ac71abb0d9f26dbdbe26c7766deebdd39b0a94b` |
| Sibling Core checkout inspected | `0823c15`, package version 6.3.0; `src/data-instance/pyret` has no diff from `v6.0.1` |
| Live audit | Node 22.22.2; Chrome 153.0.8010.54; 11 structural/characterization checks plus 11 harness checks pass |

The actual served compiler SHA-256 is
`1af61532995d5bed28b1f77e7f50cd98e69b16c4a25095096e38d1217882f2f0`.
The Core complete bundle SHA-256 is
`e1e70d08b01902c0c05c07b5cca51489318836bcc572004c56921944dcdc0239`.
The generated report records URLs, byte counts, and hashes of the compiler,
complete bundle, component bundle, and CSS. A dependency lock alone does not
prove which compiler bundle an existing build serves.

Run `npm run test:relationalization`; see the
[test protocol](../test/relationalization/README.md). Two green checks are
**loss witnesses**, not preservation claims. Upstream Pyret has not been built
or tested by this audit.

## What actually crosses the boundary

`src/web/js/trove/dom-render.js` receives the live value in `genlayout` and calls
`new core.PyretDataInstance(v, {}, window.__internalRepl)`. Core traverses it
before layout or source emission. This traversal is independent of Spyret's
`vs-constr-render` extension.

Core's `src/data-instance/pyret/pyret-data-instance.ts` uses an iterative queue
and a WeakMap from objects to atom IDs. Primitive atoms are reused by exact
type/label under the default options. Export consists of `getAtoms()`,
`getRelations()`, and `getTypes()` passed through JSON serialization.

The producer also retains original objects, an object-to-ID map, a global
constructor-pattern cache, and an optional evaluator. None is exported. The
current v6 constructor encoding supplies field order independently of that
cache. `reifyToValue` reconstructs a synthetic graph using an atom-ID memo;
`replit`/`PyretDataInstance.reify` then emits source. Synthetic structure,
printed output, and executable runtime values have different guarantees.

There is no selected root in `IDataInstance`. Both the display and older test
harness select the first atom by the traversal's current insertion order. The
new audit records that legacy selection before transport and reverses atom and
relation order on import. This is evidence for explicit root transport, not a
proposal to make first-atom selection a public contract.

## Preservation matrix

“Live” below means exercised by the new audit against the pinned bundle.
“Source” means inspected in the unchanged Core Pyret sources; it is not new
live verification of the entire value category.

| Concern | Available at input | Export and fresh-consumer interpretation | Evidence / remaining gap |
| --- | --- | --- | --- |
| Constructor fields/order | `$name`, `$arity`, `$constructor.$fieldNames`, raw `dict` slots | Binary field tuples; IDs encode `pyret:field:v1:[name, position, field]` | Live: nonalphabetical fields survive reordered transport |
| Singleton vs zero-argument application | `$arity` is -1 vs 0 | Unary `nullary-constructor` fact marks application | Live; no ordinary field needed |
| Nominal identity | Distinct constructor metadata objects and runtime brands | Atom type and field identity use only constructor spelling | Live loss: distinct declarations of `same(x)` export identically |
| Declared datatype family, absent variants, type parameters | Requires declaration context beyond observed slots; some runtime brands exist | No complete declared schema | Source: names/brands alone cannot provide erased or unobserved schema |
| Exact numbers | JS integer / js-numbers big integer, rational, rough number | `Number` atom with exact textual payload, including `~` | Live: `1/3`, large integer, `1`, and `~1`; source avoids lossy `Number` conversion for exact payloads |
| Strings and booleans | Primitive values | Typed labels distinguish them from numeric text | Source and existing inspection corpus; labels are data, not arbitrary user printing |
| Nothing vs empty object | Runtime class/protocol | `Nothing` vs `Object` type | Live |
| Ordinary object fields | `dict`, including inherited enumerable fields | `(object, Index, value)` tuples named by field | Source; callable fields filtered by default, demonstrated live loss |
| Arrays/tuples | Array slots / `vals` | `RawArray`/`Tuple`, `element(owner, Index, value)` | Live: order and duplicate occurrences survive primitive deduplication |
| Lists/options/either | Ordinary runtime data variants | Constructor graph | Existing corpus; subject to nominal-identity limitation |
| Sets | Library representation and methods | Observed constructor/storage graph, not a full behavioral contract | Source and existing corpus; custom comparator/functions are not made portable |
| String dictionaries | Reflective backing map/dict | Kind, sealed fact, ordered `entry(owner, Index, key, value)` | Live: two entries share one array atom; source emission has a separately documented aliasing gap |
| Tables | Header/row backing arrays | `column(table, Index, String)` and `row(table, Index, ...cells)` | Live: ordered headers and repeated rows; source rejects standalone Row and unsupported cells |
| Sharing vs equal-but-distinct | JS object identity | Same vs different atom IDs | Live: shared point vs two equal points; primitives intentionally deduplicate |
| Cycles and mutable fields | `$mut_fields_mask`, PRef identity and target | `mutable-field(owner, Index)`, `Reference`, `target(ref, value)` | Live: cycle closes on explicitly transported root |
| Reference state/annotations | PRef `state`, `value`, `anns` | Only initialized state 2 accepted; `unrestricted` fact records all-Any annotations | Source: unset/graphable/frozen rejected; arbitrary annotation semantics not exported |
| `_output` and methods | Callable runtime fields | Constructor traversal reads declared slots; printer behavior not serialized | Live: throwing `_output` cannot hide the `secret` field; executable methods still need declarations |
| Other functions/opaque values | Runtime kind and implementation/handle | Inconsistent: fields can disappear; generic object fallback can erase kind | Live loss for function-valued object field; source for fallback and category-specific errors |
| Selected roots, names, expressions, provenance | Observer supplies them | Not in current datum | Audit transports one root separately; multi-root sharing and provenance need an API |
| Source locations | Runtime `$loc` plus observer spans | Not exported | Compiler passes variant source location to runtime construction; do not call it an allocation site |

The table's supported subset is not “all Pyret values.” Constructor capture
visits declared slots, not every extension/behavior field in `dict`. Library
recognition is structural and can be spoofed by similarly shaped objects.
Both facts must be explicit in any stronger contract.

## Minimal counterexamples

Two independently evaluated declarations `data Local: same(x) end` and
`data Other: same(x) end` create distinct live constructor identities/brands.
For `same(1)`, the complete transported atoms/relations/types are identical.
The producer's identity observations are deliberately withheld from the
consumer. No better decoder can recover the discarded nominal distinction
from these payloads. Same-named constructors with incompatible field schemas
also risk conflicting name-keyed reconstruction metadata (source inspection).

Likewise, `{f: lam(x): x end}` and `{}` produce identical exported structure
under default options, with no capture diagnostic. Declining to serialize a
closure is reasonable; silently describing the result as complete is not.
`showFunctions: true` alone does not establish portable function semantics.

In contrast, two dictionary entries pointing to one raw array **do** retain
one array atom after export/import. The known source-emission aliasing failure
belongs downstream of capture. See the existing
[behavior witness](../test/reify-fidelity/README.md#additional-table-contents-and-behavior-evidence).

## Smallest library boundary to implement next

Proposed API, not yet a production implementation:

```ts
capturePyret(
  roots: Array<{ name: string; value: unknown; observation?: JsonObject }>,
  adapter: PyretRuntimeAdapter,
  context?: ObservationContext
): CaptureResult

// Successful portable export; datum remains authoritative for value structure.
{
  format: "spytial-pyret-capture",
  version: 1,
  datum: { atoms, relations, types },
  roots: [{ name, atomId, observation }],
  provenance: { /* caller-supplied JSON with explicit provenance */ }
}
```

1. Capture all roots in one traversal/identity map. The capture operation returns
   their IDs directly; never infer roots from graph topology or array order.
   Reject duplicate root names and dangling roots on import. Capture is a
   snapshot; later mutations do not silently update it.
2. The adapter owns classification, exact primitive extraction, declared field
   access/order, constructor identity handles, reference state/targets, and
   supported container access. It supplies live facts to the existing traversal,
   not a second serialized object tree. Start from the owning runtime's predicates
   (`isDataValue`, `isNothing`, `isTuple`, `isRef`, `isFunction`, `isMethod`,
   `isOpaque`, `isNumber`); isolate unavoidable `$...`/backing-store access.
   Do not dereference mutable fields through a convenience accessor that loses
   the reference cell. Do not execute arbitrary annotations or user printers.
3. Use strict failure for unsupported **state-bearing values**, with the root
   name, field/index path, runtime kind, and reason. No successful partial graph
   by default. Constructor methods supplied by declarations are outside the
   declared-slot snapshot contract; document that projection. Function-valued
   declared slots and ordinary object fields must not silently disappear.
4. Give observed constructors capture-scoped identities, distinct from labels.
   Keep those identities in the relational datum; update field metadata to refer
   to identity rather than spelling. A constructor/declaration atom with
   relations is a candidate, not a second side table of values. Version the
   changed encoding and test same-named constructors, builtin-name collisions,
   and existing selectors before choosing its final representation. Runtime
   brands/handles are input evidence, not stable IDs across fresh runs.
5. Keep optional declared schema/module bindings distinct from observed schema.
   Export caller-supplied origin/provenance only as such. A separate binding step
   would be needed to reconnect portable constructor identities to executable
   constructors in a fresh runtime. Do not promise that from the display name.
6. Validate imported roots, endpoint IDs, kinds, field/sequence positions, and
   format version without a browser, evaluator, or live objects. Keep original
   pointers and evaluation services in an optional session object outside the
   export. No API for graph edits is promised in this first immutable snapshot.

The envelope adds only facts the current datum lacks: selection, caller context,
and a format version. Existing exact labels, ordering relations, reference edges,
and shared atom IDs should not be duplicated in companion metadata.

## Implementation sequence and acceptance gates

1. **Core capture extraction:** move runtime-specific reads behind an adapter,
   expose explicit multi-root capture, retain the legacy `PyretDataInstance`
   path for the current display. Verify the existing structural corpus plus
   cross-root aliases, and a headless import/export test.
2. **Core preservation fixes:** add nominal identities and strict diagnostics.
   Replace the two baseline-loss assertions with positive requirements. Test
   same-name/different-layout variants together, library/builtin-name collisions,
   unsupported values in every container kind, and reference-state errors.
3. **Upstream verification:** choose and record an exact upstream revision,
   build it in isolation, and run the same capture fixtures using its owning
   runtime. Keep implementation differences inside the adapter. Success means
   the captured structure/diagnostics match the contract, not only `torepr`.
4. **IDE adoption:** consume the released capture API and preserve roots/context
   on export/import. The existing display and compiler dependency stay until
   their separately planned migration is ready.

The audit established this baseline. The subsequent implementation, upstream
verification, and IDE adoption are documented in [Pyret capture](pyret-capture.md).
