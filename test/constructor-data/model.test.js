'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const fc = require('fast-check');
const { exportValue, inspectDatum, quoteString } = require('../../src/web/js/pyret-constructor-datum');

// Synthetic runtime values test the adapter contract; the browser suite checks
// the same metadata against real Pyret. No mock printer is provided.
const rt = {
  isNumber: v => typeof v === 'number', isRef: v => !!v && v.ref === true,
  isDataValue: v => !!v && v.data === true, isMethod: v => !!v && v.method === true,
};
function ctor(name, fields = [], values = [], singleton = false) {
  return { data: true, $name: name, $arity: singleton ? -1 : fields.length,
    $constructor: { $fieldNames: fields }, $mut_fields_mask: fields.map(() => false),
    dict: Object.fromEntries(fields.map((f, i) => [f, values[i]])) };
}
const example = () => exportValue(rt, ctor('pair', ['z', 'a'], [7, 7]));

describe('Constructor datum contract (no Pyret runtime/printer in decoder)', function () {
  it('distinguishes singleton from zero-argument constructor', function () {
    assert.strictEqual(inspectDatum(exportValue(rt, ctor('same', [], [], true))), 'same');
    assert.strictEqual(inspectDatum(exportValue(rt, ctor('same'))), 'same()');
  });
  it('retains positions, names and repeated primitive occurrences', function () {
    const d = example();
    assert.strictEqual(inspectDatum(d), 'pair(7, 7)');
    assert.strictEqual(d.relations[2].tuples.length, 2);
    assert.notStrictEqual(d.relations[2].tuples[0].atoms[3], d.relations[2].tuples[1].atoms[3]);
    assert.deepStrictEqual(d.atoms.filter(a => a.type === 'CDFieldName').map(a => a.label), ['z', 'a']);
  });
  it('preserves shared identity but does not merge equal distinct values', function () {
    const x = ctor('item', ['v'], [1]);
    const shared = exportValue(rt, ctor('pair', ['x', 'y'], [x, x]));
    const separate = exportValue(rt, ctor('pair', ['x', 'y'], [x, ctor('item', ['v'], [1])]));
    assert.strictEqual(shared.atoms.filter(a => a.type === 'CDConstructor').length, 2);
    assert.strictEqual(separate.atoms.filter(a => a.type === 'CDConstructor').length, 3);
    assert.strictEqual(inspectDatum(shared), inspectDatum(separate));
  });
  it('is invariant under atom, relation and tuple enumeration order', function () {
    const d = example();
    d.atoms.reverse(); d.types.reverse(); d.relations.reverse();
    d.relations.forEach(r => r.tuples.reverse());
    assert.strictEqual(inspectDatum(JSON.parse(JSON.stringify(d))), 'pair(7, 7)');
  });
  it('accepts the read-only data-instance interface', function () {
    const d = example();
    assert.strictEqual(inspectDatum({ getAtoms: () => d.atoms, getRelations: () => d.relations }), 'pair(7, 7)');
  });
  it('decodes in a fresh realm with only the module and JSON, no host context', function () {
    const context = vm.createContext({ payload: JSON.stringify(example()) });
    const source = fs.readFileSync(require.resolve('../../src/web/js/pyret-constructor-datum'), 'utf8');
    vm.runInContext(source, context);
    assert.strictEqual(vm.runInContext('PyretConstructorDatum.inspectDatum(JSON.parse(payload))', context), 'pair(7, 7)');
  });
  it('escapes every UTF-16 code unit using Pyret conventions', function () {
    assert.strictEqual(quoteString('\n\t\r"\\é😀\0'), '"\\n\\t\\r\\"\\\\\\u00E9\\uD83D\\uDE00\\u0000"');
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 65535 })), codes => {
      const s = String.fromCharCode(...codes);
      assert.strictEqual(JSON.parse(inspectDatum(exportValue(rt, s))), s);
    }), { seed: 1, numRuns: 1000 });
  });
  it('rejects out-of-domain values explicitly, including nested values', function () {
    for (const x of [null, {}, [], () => 1, 0.5, Infinity, NaN, 2147483648]) {
      assert.throws(() => exportValue(rt, ctor('wrap', ['v'], [x])), { name: 'UnsupportedValue' });
    }
  });
  it('rejects custom printers without executing them', function () {
    const x = ctor('custom');
    x.dict._output = { method: true, full_meth() { throw new Error('must not execute'); } };
    assert.throws(() => exportValue(rt, x), e => e.reason === 'custom-output');
  });
  it('rejects cycles and mutable fields', function () {
    const x = ctor('loop', ['next'], [0]); x.dict.next = x;
    assert.throws(() => exportValue(rt, x), e => e.reason === 'cycle');
    x.$mut_fields_mask = [true];
    assert.throws(() => exportValue(rt, x), e => e.reason === 'mutable-reference');
  });

  const corruptions = {
    'missing root': d => { d.relations[0].tuples = []; },
    'multiple roots': d => { d.relations[0].tuples.push(d.relations[0].tuples[0]); },
    'duplicate atom': d => { d.atoms.push(d.atoms[0]); },
    'dangling child': d => { d.relations[2].tuples[0].atoms[3] = 'absent'; },
    'missing field': d => { d.relations[2].tuples.pop(); },
    'duplicate position': d => { d.relations[2].tuples[1].atoms[1] = d.relations[2].tuples[0].atoms[1]; },
    'duplicate field name': d => { d.relations[2].tuples[1].atoms[2] = d.relations[2].tuples[0].atoms[2]; },
    'missing arity': d => { d.relations[1].tuples = []; },
    'cycle': d => { d.relations[2].tuples[0].atoms[3] = d.relations[0].tuples[0].atoms[0]; },
    'bad integer': d => { d.atoms.find(a => a.type === 'CDInteger').label = '7.0'; },
    'metadata root': d => { d.relations[0].tuples[0].atoms[0] = d.atoms.find(a => a.type === 'CDPosition').id; },
  };
  for (const [name, corrupt] of Object.entries(corruptions)) {
    it('rejects malformed datum: ' + name, function () {
      const d = example(); corrupt(d);
      assert.throws(() => inspectDatum(d), /Invalid constructor datum/);
    });
  }
});
