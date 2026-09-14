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
  pending('number', 'rational', '1/3',
    'a jsnums Rational at the root is neither a JS primitive nor a Pyret object; it becomes an empty PyretObject atom'),
  pending('number', 'rational-field', 'box(1/3)',
    'the relationalizer turns {n, d} into the decimal n/d, which Pyret reads back as 3333333333333333/10000000000000000'),
  pending('number', 'decimal-literal', '0.5',
    'Pyret reads 0.5 as the exact rational 1/2 (see rational)'),
  pending('number', 'roughnum', '~3.14', 'Roughnum root (see rational)'),
  pending('number', 'roughnum-field', 'box(~1.5)',
    'the Roughnum field is dropped; v6 rejects the incomplete constructor datum'),
  pending('number', 'bignum', '123456789012345678901234567890', 'BigInteger root (see rational)'),
  pending('number', 'bignum-field', 'box(123456789012345678901234567890)',
    'the BigInteger field is dropped; v6 rejects the incomplete constructor datum'),

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
  pending('nothing', 'root', 'nothing',
    'nothing is a PObject with an empty dict and no brands: the datum cannot tell it from {}'),
  pending('nothing', 'field', 'box(nothing)', 'see nothing root'),

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
  pending('object', 'flat', '{x: 1, y: 2}',
    'the datum holds the x and y relations, but reify prints constructor syntax PyretObject(1, 2) instead of an object literal'),
  pending('object', 'empty', '{}', 'see object flat'),
  pending('object', 'nested', '{p: point(1, 2)}', 'see object flat'),
  pending('object', 'field', 'box({x: 1})', 'see object flat'),

  // -- tuples ----------------------------------------------------------------
  pending('tuple', 'root', '{1; 2}',
    'a PTuple has vals rather than dict, so the relationalizer records nothing for it'),
  pending('tuple', 'field', 'box({1; 2})', 'see tuple root'),
  pending('tuple', 'shared-elements', 'block:\n  p = point(1, 2)\n  {p; p}\nend', 'see tuple root'),

  // -- raw arrays ------------------------------------------------------------
  pending('raw-array', 'root', '[raw-array: 1, 2]',
    'a JS array at the root is not a Pyret object; it becomes an empty PyretObject atom'),
  pending('raw-array', 'field', 'box([raw-array: 1, 2])',
    'multiple array elements occupy one constructor position; v6 rejects the non-scalar field'),
  pending('raw-array', 'duplicates', 'box([raw-array: 1, 1])',
    'with numbersIdempotent (the default) both elements are the same atom and the duplicate tuple is dropped'),

  // -- refs and cycles -------------------------------------------------------
  pending('ref', 'ref-field', 'cell(5)',
    'the PRef field is dropped; v6 rejects the incomplete constructor datum'),
  pending('cycle', 'ref-cycle', 'block:\n  c = cell(nothing)\n  c!{next: c}\n  c\nend',
    'the cyclic PRef field is dropped; v6 rejects the incomplete constructor datum'),

  // -- functions -------------------------------------------------------------
  pending('function', 'lambda', 'lam(x): x end',
    'torepr prints <function> deterministically, but a PFunction has no dict and becomes an empty PyretObject atom'),
  pending('function', 'field', 'box(lam(x): x end)',
    'the function becomes a generic PyretObject atom; reify emits an unbound PyretObject name'),

  // -- value skeletons (_output) --------------------------------------------
  supported('skeleton', 'custom-collection', 'custom(7)',
    'the datum ignores _output; torepr applies it again to the reconstructed value'),
  supported('skeleton', 'custom-constr', 'shown(1, 2)'),
  pending('skeleton', 'list-set', '[list-set: 1, 2]',
    'reify prints list-set(link(...)), but list-set in scope is the [list-set: ...] constructor object, not a function'),
  pending('skeleton', 'tree-set', '[tree-set: 1, 2]',
    'the datum exposes the internal AVL tree (branch/leaf variants), whose constructors are not in scope'),
  pending('skeleton', 'string-dict', '[SD.string-dict: "a", 1]',
    'the entries live in an opaque JS map behind the object, so the datum is a single atom with no relations'),
  pending('skeleton', 'table', 'table: a, b row: 1, 2 end',
    'rows become an n-ary row relation, which reify does not turn back into table syntax'),

  // -- sharing and multiplicity ---------------------------------------------
  supported('sharing', 'shared-subtree', 'block:\n  p = point(1, 2)\n  pair(p, p)\nend',
    'one atom reached twice; torepr re-prints it, and so does reify'),
  supported('sharing', 'shared-deep', 'block:\n  p = point(5, 5)\n  pair(box(p), box(p))\nend'),
  supported('sharing', 'shared-singleton', 'node(1, leaf, leaf)'),
  supported('multiplicity', 'same-number-twice', 'pair(1, 1)',
    'idempotent numbers share an atom, but the two field relations keep both slots'),
];

/**
 * fast-check arbitraries over the supported forms: fixnums, printable strings,
 * booleans, the prelude's data variants, lists and option. Values are produced
 * as Pyret source text; Pyret itself computes both sides of the comparison.
 * Non-fixnum numbers, tuples, objects, raw arrays, refs and functions are
 * deliberately absent -- they are the pending desired-behavior rows above.
 */
function arbitraries(fc) {
  const int = fc.integer({ min: -999, max: 999 }).map(String);
  const strChar = fc.constantFrom(...'abcxyzABC 019_-.,:;!?'.split(''), '\\n', '\\t', '\\"', '\\\\');
  const str = fc.array(strChar, { maxLength: 6 }).map((cs) => '"' + cs.join('') + '"');
  const bool = fc.constantFrom('true', 'false');
  const atom = fc.oneof(int, str, bool, fc.constant('leaf'), fc.constant('none'), fc.constant('[list: ]'));

  const { value } = fc.letrec((tie) => ({
    value: fc.oneof(
      { maxDepth: 4, depthSize: 'small', withCrossShrink: true },
      atom,
      tie('point'),
      tie('node'),
      tie('pair'),
      tie('box'),
      tie('list'),
      tie('some'),
    ),
    point: fc.tuple(tie('value'), tie('value')).map(([a, b]) => `point(${a}, ${b})`),
    node: fc.tuple(tie('value'), tie('value'), tie('value')).map(([v, l, r]) => `node(${v}, ${l}, ${r})`),
    pair: fc.tuple(tie('value'), tie('value')).map(([a, b]) => `pair(${a}, ${b})`),
    box: tie('value').map((v) => `box(${v})`),
    list: fc.array(tie('value'), { maxLength: 4 }).map((xs) => `[list: ${xs.join(', ')}]`),
    some: tie('value').map((v) => `some(${v})`),
  }));

  return { value };
}

module.exports = { PRELUDE, ROWS, arbitraries };
