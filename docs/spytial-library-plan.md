# Plan: Redesign Spytial integration with Pyret

Status: the relationalization API is implemented in Spytial-Core, verified
against a pinned upstream Pyret runtime, and integrated into the IDE. See
[the current implementation and verification](pyret-capture.md) and
[the original boundary audit](relationalization-audit.md). The IDE now uses the
unmodified standard upstream backend and an IDE-owned display adapter.

## First scope: relationalization

Start with the boundary from live Pyret values to a portable Spytial data
instance. The broader integration ideas below are future design context;
type attachment, view selection, display APIs, and YAML replacement are deferred
and are not prerequisites for this work.

The first deliverable is a concrete account of the current relationalizer's
inputs, output encoding, and information losses, followed by the smallest
library boundary that preserves the required information.

Answer these questions first:

1. What can be recovered from the live value alone, and what requires runtime
   operations or separately supplied declaration/observation context?
2. Which of those facts survive atoms/relations/types export today?
3. Can a consumer interpret the exported structure without the original value,
   producer caches, an evaluator, or a browser?
4. Where do constructor identity, field order, sharing, cycles, references, and
   exact primitive representations need a stronger contract?
5. Which runtime-specific operations should be isolated so the same capture
   library can work against a verified upstream Pyret runtime?

Keep the current display path and default compiler dependency while evaluating
this boundary. Prefer the existing relational representation where it is
sufficient; justify any new portable metadata with a demonstrated loss.

## Purpose

Rethink how Pyret programmers define, attach, choose, and share visualizations.
The current combination of `_output`, renderer plumbing, and embedded YAML
places several unrelated responsibilities inside a datatype definition.
Replacing that machinery with a single display function would address only
part of the experience.

The design must cover how views attach to types, where specifications live,
how they are authored, and how type and value information reaches Spytial-Core.
Making this a library on upstream Pyret is an architectural objective within
that broader redesign. No particular attachment mechanism, authoring language,
or display API has been selected.

## Findings from the current code

- `package.json` depends on `sidprasad/spyret-lang#main`.
- The fork adds `vs-constr-render(name, args, renderers)`, runtime handling for
  its CLI renderer, and FFI/type declarations. ValueSkeleton itself predates
  this extension.
- `src/web/js/output-ui.js` recognizes that variant and invokes its `cpo`
  renderer to insert DOM output. Its call to `isVSConstrRender` is unconditional
  when traversal reaches that branch, so changing the dependency alone is
  insufficient.
- `src/web/js/trove/dom-render.js` passes the live value directly to
  `new core.PyretDataInstance(v, {}, window.__internalRepl)`. Relationalization
  does not require the added skeleton variant.
- The local Spytial-Core source reads runtime structure and constructor
  metadata, including `dict`, `$name`, `$arity`, and `$constructor.$fieldNames`.
  This metadata existed before the fork's rendering extension.
- The local core tracks object identity during traversal and encodes several
  reconstruction facts in the relational datum, including constructor field
  positions, sequence positions, and reference targets. Inspect the exact
  released bundle used by the IDE before assuming it matches the local source.
- The current round-trip harness exports atoms, relations, and types, with a
  separately selected root ID. Its constructor experiment measures textual
  inspection fidelity; that is not proof of identity or behavioral equivalence.

These findings come from source inspection. An upstream-runtime replacement
has not yet been built or tested.

## Goals

1. Make views reusable, discoverable, and attachable to types without `_output`
   boilerplate, including types owned by another library.
2. Support several views of a type and explicit choices for individual values.
3. Provide an authoring experience that does not require embedded YAML strings.
4. Define what capture, export, and reconstruction preserve, including type and
   declaration context needed by the chosen attachment model.
5. Make view scope, persistence, imports, and rerun behavior predictable.
6. Use upstream Pyret with a narrow runtime adapter where feasible.
7. Share capture and relationalization across IDE, standalone viewer, and
   headless use where practical.

This investigation does not promise portable serialization of arbitrary
closures, an entire execution environment, or automatic propagation of graph
edits back into a running Pyret program.

## Future design context: the view abstraction

A proposed view has a name, an applicability contract, an optional semantic
projection, and a layout specification. An attachment associates that view with
a type or other explicitly described domain. Displaying a value selects an
applicable view and supplies its observation context.

Keep four decisions independently expressible:

- **Definition:** what does the view show and how is it arranged?
- **Attachment:** which types or values is it suitable for?
- **Selection:** which view should this observation use?
- **Presentation:** where and when does the host display it?

For example, one tree type might have a structural view, an inorder sequence
view, and a balance-debugging view. A teaching library can supply these views;
a student should also be able to supply a view for the imported tree type.
Selecting a view should not change the underlying value or its structural
capture. If a view projects or aggregates data, define how displayed entities
map back to captured entities and mark any loss of information.

## Attaching views to types

Compare these mechanisms through concrete examples before choosing one:

| Mechanism | Strength | Question or cost |
| --- | --- | --- |
| Declaration-adjacent attachment | Easy to discover beside a datatype | Can existing library calls express it without new syntax or changing the datatype? |
| Explicit scoped registry | Supports imported types and several named views | Needs clear scope, identity, conflict, and rerun semantics |
| View module exporting explicit bindings | Reusable and reviewable; avoids hidden import effects | Requires a small amount of setup by the consumer |
| IDE-managed association | Quick exploration without editing a program | Must have a shareable/exportable representation and survive reloads |
| Predicate-based applicability | Can work where nominal type descriptors are unavailable | Overlap and user-code execution make automatic selection harder to explain |

A working hypothesis is named view modules with explicit, scoped attachment,
plus optional IDE affordances over the same representation. Evaluate whether
declaration-adjacent sugar is useful later. Do not assume that passing a Pyret
type annotation as an ordinary runtime value is supported: investigate which
descriptors, predicates, brands, or constructor handles the library can receive.

Resolve the following semantics explicitly:

- Does attachment target a datatype family, one variant, a structural shape,
  or a parameterized instantiation? Which of those identities exist at runtime?
- How does a datatype-level default apply to its variants, including variants
  absent from the particular value being visualized?
- How do two imported modules with identically named constructors stay distinct?
- What is the lifetime of an attachment: display call, module, program run,
  or IDE session? Rerunning definitions must not accumulate stale bindings.
- Can a library provide a suggested view without automatically making it the
  user's default? Prefer explicit installation over import-time global effects.
- How are multiple matches reported? Avoid arbitrary registration-order winners.
- Does a view apply to the selected root only, or also to nested values? Start
  with root selection; nested composition needs rules for conflicting layouts.

A candidate selection policy is: an explicit view supplied for this observation,
then an explicitly selected scoped default, then a chooser if several views
apply, then generic structural inspection. Treat that as a policy to evaluate,
not a committed API. Decide separately whether ordinary REPL evaluation shows
the diagram automatically, offers a Visualize action, or requires an explicit call.

## Replacing embedded YAML as the authoring experience

Moving the same YAML to another location and changing the language used to
author a specification solve different problems. Compare both dimensions.

| Authoring option | Benefit | Cost to evaluate |
| --- | --- | --- |
| Named external YAML/spec asset | Reusable, independently editable, compatible with current layout syntax | Multi-file loading/sharing and string-based selectors remain |
| Ordinary Pyret values and combinators | Named bindings, functions, composition, and familiar syntax | More API surface; validate fields/selectors without overpromising static type safety |
| Structured visual editor | Field/variant discovery, immediate preview, less syntax to learn | Must define saved artifact, source of truth, and unsupported advanced edits |
| New embedded syntax | Potentially concise and domain-specific | Parser/tooling work and possible renewed language coupling |

Prototype named spec assets and a small Pyret builder API against the same
layout model. Retain YAML as a possible interchange or expert format without
requiring users to embed it in `_output`. Avoid implementing two independent
versions of layout semantics.

The visual editor should operate on an identified view artifact. The current
editor finds triple-backtick strings positionally and writes YAML into the
selected source range; a redesigned workflow should not require finding the
right string literal. Define save, rename, undo, import/export, and preview
behavior for the new artifact.

Choose one editable source of truth per view. If visual editing cannot preserve
arbitrary executable Pyret builder code, offer a generated declarative artifact
or an explicit conversion rather than claiming lossless round-trip editing.
External assets also need a story for single-file classroom sharing: evaluate
ordinary named Pyret definitions, bundled project export, or packaged view modules.

## Type information and schema-aware authoring

An observed value supplies only part of a type's schema. A tree containing no
empty variant cannot reveal that variant's declaration, and an empty collection
cannot demonstrate its possible element types. Distinguish observed fields from
declared schema in the editor.

Investigate an optional schema provider supplied by the runtime adapter, module
registration, IDE analysis, or explicit user definitions. It could expose:

- Stable-within-scope datatype/variant identities, separate from display names.
- Declared field names and order, mutable fields, and available type annotations.
- Links to defining modules/source spans and the provenance of each fact.
- Explicit unknowns where runtime erasure or missing declarations prevent recovery.

Use this information to suggest selectors, explain attachment eligibility, and
report field-name mistakes. Export identities/schema required for interpreting
a saved view; keep evaluator capabilities separate. Verify how a saved attachment
is rebound to a fresh runtime rather than persisting transient brand strings
and assuming they will match after reload.

## Candidate user experiences

The following APIs are illustrative proposals, not existing functions.

| Option | Programmer experience | Required integration | Main tradeoff |
| --- | --- | --- | --- |
| Explicit display | `S.show(tree, spec)` | JavaScript-backed library and display host | Clear invocation; display is an effect |
| Visualization value | `S.view(tree, spec)` | Library and host renderer for the result | Composable values; richer REPL output needs host support |
| IDE inspection | Evaluate `tree`, then choose Visualize | IDE access to evaluated values | Minimal program changes; host-specific interaction |
| Snapshot export | Capture/export, then open a viewer | Capture library and separate viewer | Portable workflow; less immediate interaction |

These options can share an implementation. Evaluate invocation together with
type attachment and authoring; a shorter display call alone is not sufficient
evidence that the integration has become easier to use.

Evaluate these experiences with small programs before selecting the public API:

- Visualize a datatype defined in an imported library.
- Show the same tree with two layout specifications.
- Apply a reusable view to several values.
- Visualize a primitive, a collection, and a cyclic structure.
- Use a value whose custom `_output` omits or rearranges fields.
- Run without a graphical host and obtain a useful export or explicit error.

Keep layout configuration separate from datatype definitions by default. Decide
how named/reusable specifications and the existing specification editor fit
into the selected API.

## Proposed information boundary

```text
live value + runtime adapter + optional observation context
                         |
                  capture / relationalize
                         |
        portable datum + selected roots + provenance
                         |
                     display host
```

This is a conceptual boundary, not a commitment to a new intermediate format.
First assess whether the existing `PyretDataInstance` and relational encoding
can satisfy it with incremental changes.

### Value structure

For the supported value domain, specify preservation of:

- Constructor identity, ordered fields, and singleton versus zero-argument
  constructor distinctions.
- Exact numeric content and distinctions such as exact versus rough numbers.
- Container kinds, element order, and table contents.
- Shared objects versus equal-but-distinct objects, cycles, and reference cells.
- Mutable field information and reference state at the time of capture.

Capture live structure before display rendering. `_output`, `torepr`, or a
display skeleton can intentionally omit information and should not define the
structural export contract. Library-specific adapters may provide semantic
views, but any lossy projection must be explicit.

Constructor names alone are insufficient for distinguishing unrelated
constructors with the same spelling. Investigate runtime identities/brands and
module or declaration metadata. Separate identity within one capture/session
from identities that remain meaningful across exports and fresh runtimes.

### Observation context

Allow the caller or IDE to supply selected roots, labels, source expressions,
source spans, and relevant module/declaration context.

A value does not inherently contain its variable name. If `a` and `b` point to
the same object, those bindings must come from the observer. Likewise, existing
runtime location metadata must be checked for its actual meaning before using
it as an allocation site or expression location.

Keep root selection explicit. Support multiple named roots where useful,
captured together so sharing between roots remains visible. Do not make array
iteration order the public root-selection contract.

### Live capabilities

Keep access to original objects, evaluator services, and runtime operations in
a session layer. Such capabilities may support interactive inspection or later
editing, but they are not ordinary serializable metadata.

A saved snapshot should remain usable without the producing session. If an
operation requires that session, expose that limitation explicitly.

## Library and host responsibilities

### Pyret runtime adapter

Provide the operations needed to classify values, inspect constructors and
fields, distinguish numeric representations, and read supported containers and
references. Prefer available runtime operations; isolate unavoidable internal
representation assumptions and test them against the chosen upstream version.

Pass capabilities explicitly rather than making relationalization depend on
the browser global `window.__internalRepl`. Evaluation should be optional for
capturing an already available value.

Pyret supports handwritten JavaScript-backed modules receiving the runtime.
This establishes a possible packaging route, but does not establish that an
arbitrary browser IDE can import and display such a module without integration:
<https://pyret.org/docs/latest/Module_Representation.html>.

### Spytial-Core

Own reusable relationalization/reconstruction semantics and the portable data
contract. Keep facts required for reconstruction in the exported datum or an
explicitly versioned portable companion format. Do not rely on producer caches
or original-object pointers to recover required facts.

Prefer extending the existing encoding. If a companion format is necessary,
specify its export/import behavior and how graph edits keep it consistent.
Avoid duplicating authoritative structure across two representations.

### Pyret library facade

Expose capture, view/display, and export through a small API. Hide skeleton
construction, DOM objects, and evaluator plumbing from ordinary programs.
Provide extension points for library-specific value adapters where necessary.

### Display host

Mount the graph, manage asynchronous rendering and cleanup, report errors, and
connect the layout editor. The host may be SPyret-IDE or a standalone viewer.

Investigate existing upstream output facilities before adding a new mechanism.
If a host extension is needed, prefer a generic renderer registration boundary.
Do not assume ordinary upstream ValueSkeleton output supports arbitrary
interactive DOM. A generic upstream host hook is a possible long-term outcome,
not a prerequisite for the initial prototype.

## Preservation limits and decisions to make

| Concern | Decision needed |
| --- | --- |
| Snapshot versus live view | Start with explicit snapshots/refresh, or introduce mutation observation? |
| Functions and opaque values | Registered adapter, marked live-only handle, or explicit unsupported result? |
| Unsupported nested values | Reject capture or report a partial result with precise omissions? Never silently claim fidelity. |
| Reconstruction | Structural graph, printable source, executable value, or several separately documented guarantees? |
| Datatype declarations | Supply dependencies when evaluating reconstructed source; define what provenance export preserves. |
| Display customization | Keep user printers optional and separate from structural traversal. |
| Graph edits | Define metadata consistency and validity before promising edited-value reconstruction. |
| Format evolution | Version any new portable contract and define compatibility expectations. |

Printed equality, structural fidelity, and executable reconstruction must have
separate claims. Reconstructed source may need the original datatype declarations
in scope. A snapshot of a reference preserves state at capture time; following
later mutations requires additional machinery.

## Staged investigation and implementation

### 1. Audit the relationalization boundary

- Record the IDE compiler dependency and actual Spytial-Core asset versions.
- Trace the value received by `PyretDataInstance`, runtime internals consulted,
  and facts written to atoms, relations, types, or retained only in memory.
- Build a preservation matrix: information available at input, information
  exported, information recoverable by a fresh consumer, and known losses.
- Cover constructors and same-named types, exact primitives, collections,
  sharing, cycles, mutable references, custom printing, and unsupported values.
- Separate observed value structure from optional declared schema and provenance.

Deliverable: a concrete boundary audit and representative counterexamples or
fixtures. Do not infer structural fidelity from printed equality alone.

### 2. Define and prototype a minimal capture contract

- Define required inputs and optional runtime/context capabilities based on the
  audit. Capture of an existing value should not require a REPL evaluator.
- Define selected roots and a clear supported-value/unsupported-value policy.
- Prototype capture without invoking `_output`, the custom skeleton, or DOM code.
- Export/import the result in a fresh consumer with selected roots preserved.
- Keep the existing relational encoding wherever it satisfies the contract.

Deliverable: a small library-facing capture boundary and an explicit list of
preservation guarantees and gaps, independent of the future display API.

### 3. Close and verify information-preservation gaps

- Add a preservation matrix for each supported value kind.
- Resolve constructor identity collisions and define provenance/root handling.
- Test export/import without live values, producer caches, or evaluator access.
- Implement missing portable facts in Spytial-Core and runtime-specific access
  in the adapter; verify the IDE as a downstream consumer.

Deliverable: a documented contract backed by structural tests, in addition to
the existing textual-fidelity tests.

### 4. Verify upstream runtime compatibility

- Select an upstream Pyret revision and use an isolated checkout/build.
- Exercise the same capture contract and structural corpus against that runtime.
- Isolate runtime representation differences in the adapter.
- Confirm relationalization needs neither the custom skeleton nor the IDE host.

Deliverable: evidence of upstream compatibility and any remaining runtime gaps.
The IDE now builds against that pinned, unmodified upstream backend. Its
property-based tests and browser display tests are acceptance gates for the switch.

### Deferred: redesign the user-facing integration

- Compare complete workflows for type attachment, default and alternate views,
  imported types, authoring, rerunning programs, and sharing.
- Compare external specifications, Pyret builder definitions, and visual editing.
- Select the attachment/selection policy and artifact ownership model.
- Prototype the chosen display API and specification-editor integration.

These decisions should build on the relationalization contract established above.

### Implemented: migrate the IDE and remove the fork dependency

- Replace the `vs-constr-render` display path and migrate its consumers.
- Update examples, specification editing, documentation, and dependency locks.
- Switch to the verified upstream runtime revision.
- Run the IDE's build, client tests, constructor round trips, and broader fidelity
  suite; compare results with the baseline.

Deliverable: an upstream-based IDE with documented library and host boundaries.
The implementation pins the official `drydock` source as a Git submodule and
uses `DR.show` with standard opaque values and `VS.vs-value`, replacing the
fork-only skeleton. See [the migration guide](pyret-capture.md).

## Relationalization validation criteria

The prototype should establish that:

- Relationalization works independently of the custom skeleton and DOM rendering.
- Capturing an already evaluated value requires no `_output` changes or evaluator.
- Shared children and equal-but-distinct children remain distinguishable.
- Constructor field order and same-named constructors are handled explicitly.
- Cycles and supported references survive export/import structurally.
- Custom printing cannot silently remove fields from structural capture.
- Selected roots and supplied provenance survive the intended export workflow.
- Unsupported values produce explicit diagnostics.
- A fresh consumer can reconstruct the promised structure without producer caches.
- Required declarations and live-only capabilities are documented separately.

## Recommended first scope

Begin with the relationalization audit: trace what enters, what is retained,
what is exported, and what a fresh consumer can recover. Use demonstrated gaps
to define a minimal capture contract and structural tests, then verify it against
upstream Pyret. Type attachment, YAML replacement, display behavior, automatic
live updates, and bidirectional editing remain later work.
