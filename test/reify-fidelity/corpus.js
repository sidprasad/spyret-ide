'use strict';

/**
 * Pyret instance of the cross-language reify evaluation (see the reify-eval
 * repository, which sits beside this checkout in spytial-org).
 *
 * One question, asked once per host language: does the Spytial datum say
 * enough to reproduce the language's own inspection output for a value? In
 * Pyret the chosen textual inspection output is `torepr`, and the
 * two paths compared are
 *
 *   value -- torepr ------------------------------------------------> string
 *   value -- PyretDataInstance -> JSON -> isolated decoder -------> string
 *
 * Both suites use ../pyret-round-trip/harness: the live value goes directly
 * through the working relationalizer, then default JSON normalization and
 * cache-independent reification in a separate page. PRELUDE is loaded only
 * AFTER reification, to evaluate the completed expression. No field schema,
 * primitive adapter, original value or inspection string reaches the reifier.
 *
 * Every in-scope row has the same desired outcome: exact inspection fidelity.
 * Implementation status controls only when its assertion runs in normal CI:
 *
 *   supported    -- enabled regression; must round-trip exactly.
 *   pending      -- executable desired-behavior test for a known gap. Run with
 *                   REIFY_INCLUDE_PENDING=1 while implementing support.
 *   out-of-scope -- torepr is not a function of the value alone; not a promise.
 *
 * Scope: reify prints constructors by their bare variant name ($name carries no
 * module), so the prelude that evaluates the reify string must bind the
 * constructors unqualified; built-in modules are therefore `include`d.
 *
 * Note on mechanism: the runtime hands spytial-core raw values
 * ({dict, brands, $name}), not value skeletons. Plain data variants never
 * build a skeleton (torepr prints them from $constructor.$fieldNames); a
 * value's `_output` skeleton is consulted by torepr on both paths, not by
 * the importer.
 */

const PRELUDE = `
import valueskeleton as VS
import string-dict as SD
include either
include tables
include string-dict

data Point: point(x, y) end
data Tree: leaf | node(v, l, r) end
data Pair: pair(fst, snd) end
data Box: box(v) end
data Zero: zero() end
data Cell: cell(ref next) end
data WithMeth: wm(n) with: method double(self): self.n * 2 end end
data Sharing: sh(a) sharing: method twice(self): self.a * 2 end end
data Custom: custom(a) with:
  method _output(self): VS.vs-collection("custom", [list: VS.vs-value(self.a)]) end
end
data Shown: shown(a, b) with:
  method _output(self): VS.vs-constr("shown", [list: VS.vs-value(self.b), VS.vs-value(self.a)]) end
end
`;

function row(category, name, expr, expect, note) {
  return { category, name, expr, expect, desiredVerdict: 'pass', note };
}
const supported = (category, name, expr, note) => row(category, name, expr, 'supported', note);
const pending = (category, name, expr, note) => row(category, name, expr, 'pending', note);

/**
 * Representative rows keyed to the runtime's `torepr` dispatch
 * (number, string, boolean, nothing, data value, plain object, tuple, raw
 * array, ref, function, value-skeleton `_output`).
 */
const ROWS = [
  // -- numbers ---------------------------------------------------------------
  supported('number', 'fixnum', '5'),
  supported('number', 'negative', '-4'),
  supported('number', 'zero', '0'),
  supported('number', 'fixnum-field', 'box(5)'),
  supported('number', 'rational', '1/3'),
  supported('number', 'rational-field', 'box(1/3)'),
  supported('number', 'decimal-literal', '0.5'),
  supported('number', 'roughnum', '~3.14'),
  supported('number', 'roughnum-field', 'box(~1.5)'),
  supported('number', 'bignum', '123456789012345678901234567890'),
  supported('number', 'bignum-field', 'box(123456789012345678901234567890)'),

  // -- strings ---------------------------------------------------------------
  supported('string', 'plain', '"hi"'),
  supported('string', 'empty', '""'),
  supported('string', 'escapes', '"a\\nb\\"c\\\\\\t"'),
  supported('string', 'unicode', '"é"',
    'torepr re-escapes non-ASCII as \\uXXXX on the way back, so the raw character in the reify string is fine'),
  supported('string', 'control-char', '"\\u0001"'),
  supported('string', 'field', 'box("hi")'),
  supported('string', 'looks-like-number', 'pair("5", 5)', 'type tag keeps "5" and 5 distinct'),

  // -- booleans / nothing ----------------------------------------------------
  supported('boolean', 'true', 'true'),
  supported('boolean', 'false', 'false'),
  supported('boolean', 'field', 'box(false)'),
  supported('nothing', 'root', 'nothing'),
  supported('nothing', 'field', 'box(nothing)'),

  // -- user data variants ----------------------------------------------------
  supported('data', 'singleton', 'leaf'),
  supported('data', 'nullary-constructor', 'zero()',
    'v6 records arity and distinguishes zero() from a singleton'),
  supported('data', 'flat', 'point(1, 2)'),
  supported('data', 'nested', 'box(point(1, 2))'),
  supported('data', 'tree', 'node(1, node(2, leaf, leaf), node(3, leaf, node(4, leaf, leaf)))'),
  supported('data', 'with-method', 'wm(3)', 'a with: method lives on the dict and is skipped'),
  supported('data', 'sharing-method', 'sh(2)', 'a sharing: method lives on the dict prototype and is never seen'),
  supported('data', 'equal-but-distinct', 'pair(point(1, 2), point(1, 2))',
    'two structurally equal objects are two atoms'),

  // -- built-in data ---------------------------------------------------------
  supported('builtin-data', 'some', 'some(1)'),
  supported('builtin-data', 'none', 'none'),
  supported('builtin-data', 'left', 'left("x")',
    'reify prints bare variant names, so the scope that evaluates it must bind them unqualified (include, not import as)'),
  supported('builtin-data', 'right', 'right(point(1, 2))'),
  supported('builtin-data', 'empty-list', '[list: ]'),
  supported('builtin-data', 'list', '[list: 1, 2, 3]',
    'reify prints the link chain; torepr turns it back into [list: ...] via the list _output skeleton'),
  supported('builtin-data', 'nested-list', '[list: [list: 1], [list: 2, 3], [list: ]]'),
  supported('builtin-data', 'list-of-data', '[list: point(1, 2), some(leaf), none]'),
  supported('builtin-data', 'list-with-duplicates', '[list: 1, 1, 1]', 'each link is its own atom'),
  supported('builtin-data', 'list-field', 'box([list: 1, 1])'),

  // -- plain objects ---------------------------------------------------------
  supported('object', 'flat', '{x: 1, y: 2}'),
  supported('object', 'empty', '{}'),
  supported('object', 'nested', '{p: point(1, 2)}'),
  supported('object', 'field', 'box({x: 1})'),

  // -- tuples ----------------------------------------------------------------
  supported('tuple', 'root', '{1; 2}'),
  supported('tuple', 'field', 'box({1; 2})'),
  supported('tuple', 'shared-elements', 'block:\n  p = point(1, 2)\n  {p; p}\nend'),

  // -- raw arrays ------------------------------------------------------------
  supported('raw-array', 'root', '[raw-array: 1, 2]'),
  supported('raw-array', 'field', 'box([raw-array: 1, 2])'),
  supported('raw-array', 'duplicates', 'box([raw-array: 1, 1])'),

  // -- refs and cycles -------------------------------------------------------
  supported('ref', 'ref-field', 'cell(5)'),
  supported('cycle', 'ref-cycle', 'block:\n  c = cell(nothing)\n  c!{next: c}\n  c\nend'),

  // -- functions -------------------------------------------------------------
  pending('function', 'lambda', 'lam(x): x end',
    'torepr prints <function> deterministically, but a PFunction has no dict and becomes an empty PyretObject atom'),
  pending('function', 'field', 'box(lam(x): x end)',
    'the function becomes a generic PyretObject atom; reify emits an unbound PyretObject name'),

  // -- value skeletons (_output) --------------------------------------------
  supported('skeleton', 'custom-collection', 'custom(7)',
    'the datum ignores _output; torepr applies it again to the reconstructed value'),
  supported('skeleton', 'custom-constr', 'shown(1, 2)'),
  supported('skeleton', 'list-set', '[list-set: 1, 2]'),
  supported('skeleton', 'tree-set', '[tree-set: 1, 2]'),
  supported('skeleton', 'string-dict', '[SD.string-dict: "a", 1]'),
  supported('skeleton', 'table', 'table: a, b row: 1, 2 end'),

  // -- sharing and multiplicity ---------------------------------------------
  supported('sharing', 'shared-subtree', 'block:\n  p = point(1, 2)\n  pair(p, p)\nend',
    'one atom reached twice; reification preserves the shared value'),
  supported('sharing', 'shared-deep', 'block:\n  p = point(5, 5)\n  pair(box(p), box(p))\nend'),
  supported('sharing', 'shared-singleton', 'node(1, leaf, leaf)'),
  supported('multiplicity', 'same-number-twice', 'pair(1, 1)',
    'idempotent numbers share an atom, but the two field relations keep both slots'),
];

// Library and graph witnesses are bounded deliberately. Inspection equality is
// still the assertion here; contents/aliasing are tested separately below.
ROWS.push(
  supported('set', 'empty-list-set', '[list-set: ]'),
  supported('set', 'empty-tree-set', '[tree-set: ]'),
  supported('set', 'list-order-duplicates', '[list-set: 3, 1, 2, 1]'),
  supported('set', 'tree-order-duplicates', '[tree-set: 3, 1, 2, 1]'),
  supported('set', 'nested-elements', '[list-set: box(1/3), box(nothing)]'),
  supported('dictionary', 'empty', '[string-dict: ]'),
  supported('dictionary', 'ordered-keys', '[string-dict: "z", 1, "a", 2, "10", 3, "2", 4]'),
  supported('dictionary', 'nested-values', '[string-dict: "a", {x: [raw-array: 1/3, nothing]}, "b", {~1.5; box(7)}]'),
  supported('dictionary', 'mutable', '[mutable-string-dict: "a", 1, "b", 2]'),
  supported('dictionary', 'sealed', '[mutable-string-dict: "a", 1].seal()'),
  supported('dictionary', 'self-cycle', 'block:\n  d = [mutable-string-dict: ]\n  d.set-now("self", d)\n  d\nend'),
  supported('dictionary', 'shared-array', 'block:\n  a = [raw-array: 1]\n  [string-dict: "a", a, "b", a]\nend'),
  supported('cycle', 'two-cells', 'block:\n  a = cell(nothing)\n  b = cell(a)\n  a!{next: b}\n  a\nend'),
  supported('ref', 'shared-cell', 'block:\n  c = cell(5)\n  {a: c, b: c, separate: cell(5)}\nend'),
  supported('table', 'empty', 'table: name, score end'),
  supported('table', 'zero-columns', 'empty-table([list: ]).add-row([raw-row: ]).add-row([raw-row: ])'),
  supported('table', 'rows-and-duplicates', 'table: name, score row: "Ada", 1/3 row: "Ada", 1/3 row: "Grace", ~2.5 end'),
  supported('table', 'nested-cells', 'table: a, b row: {x: [raw-array: nothing, 1/3]}, {box(7); true} row: [list-set: 3, 1], [string-dict: "x", 8] end'),
  supported('table', 'nested-table', 'table: a row: table: inner row: 5 end end'),
  supported('table', 'unusual-headers', '[table-from-columns: {"has space"; [list: 1]}, {"end"; [list: 2]}]'),
  supported('table', 'shared-array', 'block:\n  a = [raw-array: 1]\n  table: a, b row: a, a end\nend'),
  supported('table', 'reference-cycle', 'block:\n  c = cell(nothing)\n  t = table: a row: c end\n  c!{next: t}\n  t\nend'),
  supported('table', 'dictionary-cycle', 'block:\n  d = [mutable-string-dict: ]\n  t = table: a row: d end\n  d.set-now("table", t)\n  t\nend'),
);

/** Bounded recursive source values. Pyret computes both inspection strings. */
function arbitraries(fc) {
  const int = fc.integer({ min: -999, max: 999 }).map(String);
  const rational = fc.tuple(fc.integer({ min: -99, max: 99 }), fc.integer({ min: 2, max: 99 }))
    .map(([n, d]) => `${n}/${d}`);
  const number = fc.oneof(int, rational, fc.constantFrom('~1.5', '~-2.75',
    '123456789012345678901234567890', '-123456789012345678901234567890'));
  const strChar = fc.constantFrom(...'abcxyzABC 019_-.,:;!?'.split(''), '\\n', '\\t', '\\"', '\\\\');
  const str = fc.array(strChar, { maxLength: 6 }).map(cs => '"' + cs.join('') + '"');
  const atom = fc.oneof(number, str, fc.constantFrom('true', 'false', 'nothing', 'leaf', 'none', '{}', '[raw-array: ]', '[list: ]'));

  const recursive = fc.letrec(tie => ({
    value: fc.oneof({ maxDepth: 3, depthSize: 'small', withCrossShrink: true },
      atom, tie('point'), tie('node'), tie('pair'), tie('box'), tie('list'),
      tie('option'), tie('either'), tie('object'), tie('tuple'), tie('array'),
      tie('repeated'), tie('shared'), tie('dictionary')),
    point: fc.tuple(tie('value'), tie('value')).map(([a, b]) => `point(${a}, ${b})`),
    node: fc.tuple(tie('value'), tie('value'), tie('value')).map(([v, l, r]) => `node(${v}, ${l}, ${r})`),
    pair: fc.tuple(tie('value'), tie('value')).map(([a, b]) => `pair(${a}, ${b})`),
    box: tie('value').map(v => `box(${v})`),
    list: fc.array(tie('value'), { maxLength: 3 }).map(xs => `[list: ${xs.join(', ')}]`),
    option: tie('value').map(v => `some(${v})`),
    either: fc.tuple(fc.boolean(), tie('value')).map(([left, v]) => `${left ? 'left' : 'right'}(${v})`),
    object: fc.tuple(tie('value'), tie('value')).map(([a, b]) => `{x: ${a}, y: ${b}}`),
    tuple: fc.tuple(tie('value'), tie('value')).map(([a, b]) => `{${a}; ${b}}`),
    array: fc.array(tie('value'), { maxLength: 3 }).map(xs => `[raw-array: ${xs.join(', ')}]`),
    repeated: tie('value').map(v => `[raw-array: ${v}, ${v}]`),
    shared: tie('value').map(v => `block:\n  shared-value = box(${v})\n  {a: shared-value, b: [raw-array: shared-value, shared-value]}\nend`),
    dictionary: fc.tuple(tie('value'), tie('value')).map(([a, b]) => `[string-dict: "a", ${a}, "b", ${b}]`),
  })).value;
  const set = fc.tuple(fc.constantFrom('list-set', 'tree-set'), fc.array(int, { maxLength: 5 }))
    .map(([kind, xs]) => `[${kind}: ${xs.join(', ')}]`);
  // Initialized, unrestricted PRefs owned by mutable constructor fields; rings
  // have one to four nodes. Direct raw-array cycles are outside this subset.
  const cycle = fc.integer({ min: 1, max: 4 }).map(n => 'block:\n' +
    Array.from({ length: n }, (_, i) => `c${i} = cell(nothing)`).join('\n') + '\n' +
    Array.from({ length: n }, (_, i) => `c${i}!{next: c${(i + 1) % n}}`).join('\n') + '\nc0\nend');
  return { value: fc.oneof({ weight: 8, arbitrary: recursive }, { weight: 1, arbitrary: set }, { weight: 1, arbitrary: cycle }) };
}

module.exports = { PRELUDE, ROWS, arbitraries };
