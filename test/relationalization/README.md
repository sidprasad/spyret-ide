# Relationalization boundary audit

`capture.test.js` additionally exercises the **new production capture API**:
all 86 enabled corpus examples import in a headless realm, dictionary sharing
survives, unsupported nested functions report a path, and the real diagram path
works without the browser REPL global. The baseline protocol below applies to
`boundary.test.js`; its two known losses are fixed in the new API. See the
[current integration](../../docs/pyret-capture.md).

Run `npm run test:relationalization` with the same prerequisites as the
[real-Pyret harness](../reify-fidelity/README.md#running): a built IDE, Node 22,
Chrome, and access to the pinned Core CDN assets. The constructor CI workflow
runs this once (seed 1) and uploads the report with its other evidence.

This is an audit of **Spyret’s legacy adapter** against released Core 6.3.2,
not a claim of complete fidelity.
Nine structural checks exercise preservation; two explicitly named
`[known loss]` checks demonstrate distinctions that disappear. When those losses
are fixed, replace the characterization assertions with preservation assertions
and update the [audit](../../docs/relationalization-audit.md). Do not count a
passing loss witness as supported fidelity.

`captureWorkingCase` uses the existing REPL only to obtain a real runtime value,
then calls `new PyretDataInstance(value)` with no evaluator. It does not call
`torepr`, `_output`, the custom skeleton, or DOM rendering. A separate unit test
checks that invocation boundary. A live fixture has an `_output` that throws.

The producer exports atoms, relations, types, and a separately selected root.
Only that packet crosses into a fresh `JSONDataInstance` in a second page; the
receiver reverses atom/relation order and clears its constructor cache. Node
assertions inspect the received edges, IDs, positions, kinds, and exact labels.
They do not reconstruct source or compare printed output.

The nominal-identity witness records producer-only constructor identity tokens
and runtime brands. These are observations of the original input, **not** a
metadata repair: they never reach the consumer or affect its result. Different
declarations of `same(x)` currently yield identical exported graphs.

`build/relationalization-audit.json` contains the prelude, input expressions,
exported graphs, live constructor observations, check results, and fingerprints
of the actual served Pyret/Core assets. Override the path using
`RELATIONALIZATION_REPORT`. The report is local generated evidence, not a golden
file; relation IDs may be random. The tests require no snapshot-ID stability.

This suite establishes evaluator-free **capture**, not headless loading of the
whole Core browser bundle, upstream Pyret compatibility, arbitrary function
serialization, executable reconstruction, or post-capture mutation tracking.
