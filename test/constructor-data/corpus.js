'use strict';

const PRELUDE = `
data Tree:
  | tip
  | branch(value :: Number, left :: Tree, right :: Tree)
end
data Expr:
  | lit(value :: Number)
  | add(left :: Expr, right :: Expr)
  | choose(condition :: Boolean, yes :: Expr, no :: Expr)
end
data Chain<A>:
  | stop
  | more(first :: A, rest :: Chain<A>)
end
data Rose:
  | rose(label :: String, children :: Forest)
end
data Forest:
  | no-trees
  | trees(first :: Rose, rest :: Forest)
end
data Wrapper:
  | wrap(value)
  | duo(zebra, alpha)
  | singleton
  | zero()
end
data Cell: cell(ref next) end
data WithMethod:
  | with-method(n) with:
    method double(self): self.n * 2 end
end
data Custom:
  | custom(n) with:
    method _output(self): raise("custom printer must not run") end
end
`;

const CASES = [
  ['integer-zero', '0'], ['integer-min', '-2147483648'], ['integer-max', '2147483647'],
  ['boolean-true', 'true'], ['boolean-false', 'false'], ['empty-string', '""'],
  ['escaping', '"a\\n\\t\\r\\"\\\\"'], ['unicode', '"é😀\\u0000\\u007F\\u2028"'],
  ['singleton', 'singleton'], ['zero-constructor', 'zero()'],
  ['primitive-box', 'wrap(false)'], ['different-leaf-types', 'duo("5", 5)'],
  ['field-order', 'duo(9, 2)'], ['repeated-value', 'duo(1, 1)'],
  ['tree-base', 'tip'], ['tree-recursive', 'branch(1, branch(2, tip, tip), tip)'],
  ['expression', 'choose(true, add(lit(1), lit(2)), lit(3))'],
  ['chain-base', 'stop'], ['chain-integers', 'more(1, more(1, stop))'],
  ['chain-strings', 'more("a", more("b", stop))'],
  ['mutual-base', 'rose("root", no-trees)'],
  ['mutual-recursive', 'rose("root", trees(rose("child", no-trees), no-trees))'],
  ['shared-subtree', 'block:\n t = branch(1, tip, tip)\n duo(t, t)\nend'],
  ['equal-distinct-subtrees', 'duo(branch(1, tip, tip), branch(1, tip, tip))'],
  ['ordinary-method', 'with-method(3)'],
  ['interaction-declared-constructor', 'data Fresh: fresh(z, a) end\nfresh(9, 2)'],
].map(([name, expr]) => ({ name, expr }));

const REJECTED = [
  ['fraction', '1/3', 'integer-domain'], ['roughnum', '~1', 'integer-domain'],
  ['integer-below', '-2147483649', 'integer-domain'], ['integer-above', '2147483648', 'integer-domain'],
  ['big-integer', '123456789012345678901234567890', 'integer-domain'],
  ['nested-fraction', 'wrap(1/3)', 'integer-domain'],
  ['nothing', 'nothing', 'not-constructor-data'], ['object', '{x: 1}', 'not-constructor-data'],
  ['tuple', '{1; 2}', 'not-constructor-data'], ['array', '[raw-array: 1, 1]', 'not-constructor-data'],
  ['function', 'lam(x): x end', 'not-constructor-data'],
  ['nested-object', 'wrap({x: 1})', 'not-constructor-data'],
  ['mutable-field', 'cell(1)', 'mutable-reference'],
  ['reference-cycle', 'block:\n c = cell(nothing)\n c!{next: c}\n c\nend', 'mutable-reference'],
  ['custom-printer', 'custom(1)', 'custom-output'],
  ['nested-custom-printer', 'wrap(custom(1))', 'custom-output'],
  ['builtin-list', '[list: 1, 2]', 'custom-output'],
].map(([name, expr, reason]) => ({ name, expr, reason }));

// Type-directed generators: recursive child positions always have the declared
// datatype. Depth is a hard construction bound, not just a sampling preference.
function arbitraries(fc) {
  const integer = fc.integer({ min: -2147483648, max: 2147483647 }).map(String);
  const string = fc.array(fc.integer({ min: 0, max: 65535 }), { maxLength: 12 })
    .map(codes => '"' + codes.map(n => '\\u' + n.toString(16).padStart(4, '0')).join('') + '"');
  const boolean = fc.boolean().map(String);
  function tree(depth) {
    return depth === 0 ? fc.constant('tip') : fc.oneof(fc.constant('tip'),
      fc.tuple(integer, tree(depth - 1), tree(depth - 1)).map(([v, l, r]) => `branch(${v}, ${l}, ${r})`));
  }
  function expr(depth) {
    const base = integer.map(n => `lit(${n})`);
    if (!depth) return base;
    return fc.oneof(base,
      fc.tuple(expr(depth - 1), expr(depth - 1)).map(([l, r]) => `add(${l}, ${r})`),
      fc.tuple(boolean, expr(depth - 1), expr(depth - 1)).map(([b, l, r]) => `choose(${b}, ${l}, ${r})`));
  }
  const chain = fc.array(string, { maxLength: 6 }).map(xs => xs.reduceRight((r, x) => `more(${x}, ${r})`, 'stop'));
  function rose(depth) {
    const children = depth ? fc.array(rose(depth - 1), { maxLength: 3 }) : fc.constant([]);
    return fc.tuple(string, children).map(([s, rs]) =>
      `rose(${s}, ${rs.reduceRight((r, x) => `trees(${x}, ${r})`, 'no-trees')})`);
  }
  return { tree: tree(4), expression: expr(3), chain, mutual: rose(3), primitive: fc.oneof(integer, string, boolean) };
}

// Vary the declaration, not only values of handpicked datatypes. Every schema
// has both base forms and 1-4 variants of arity 1-4, with primitive/recursive fields.
function schemaArbitrary(fc) {
  return fc.array(fc.array(fc.constantFrom('Number', 'String', 'Boolean', 'Generated'),
    { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 4 }).map(variants => {
    const names = ['z', 'a', 'middle', 'b'];
    const prelude = 'data Generated:\n  | base\n  | vacant()\n' + variants.map((fields, i) =>
      `  | variant${i}(${fields.map((t, j) => `${names[j]} :: ${t}`).join(', ')})`).join('\n') + '\nend';
    function value(depth) {
      const bases = fc.constantFrom('base', 'vacant()');
      if (!depth) return bases;
      return fc.oneof(bases, ...variants.map((fields, i) => fc.tuple(...fields.map(t => {
        if (t === 'Generated') return value(depth - 1);
        if (t === 'Number') return fc.integer({ min: -999, max: 999 }).map(String);
        if (t === 'String') return fc.constantFrom('""', '"hello"', '"\\u00E9"');
        return fc.boolean().map(String);
      })).map(args => `variant${i}(${args.join(', ')})`)));
    }
    // Include a use of every generated constructor, independently of sampling.
    const witnesses = ['base', 'vacant()', ...variants.map((fields, i) =>
      `variant${i}(${fields.map(t => ({ Generated: 'base', Number: '1', String: '"x"', Boolean: 'false' })[t]).join(', ')})`)];
    return { prelude, witnesses, value: value(3) };
  });
}

module.exports = { PRELUDE, CASES, REJECTED, arbitraries, schemaArbitrary };
