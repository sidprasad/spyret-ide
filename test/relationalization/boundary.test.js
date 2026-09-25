'use strict';

// Structural evidence for the relationalization audit. These assertions never
// use source reification or printed equality as a proxy for graph preservation.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { start } = require('../pyret-round-trip/harness');

const PRELUDE = `
include tables
include string-dict
data Point: point(x, y) end
data Pair: pair(fst, snd) end
data Cell: cell(ref next) end
data Empty: empty-variant | zero() end
data Ordered: ordered(zebra, alpha) end
data Hidden: hidden(visible, secret) with:
  method _output(self): raise("capture called _output") end
end
data Local: same(x) end
left-type = {make: same, accepts: is-Local}
`;

function atom(row, id) {
  const a = row.datum.atoms.find(a => a.id === id);
  assert.ok(a, 'Missing atom ' + id);
  return a;
}
function tuples(row, name, owner = row.rootId) {
  return row.datum.relations.filter(r => r.name === name)
    .flatMap(r => r.tuples).map(t => t.atoms).filter(t => t[0] === owner);
}
function target(row, name, owner = row.rootId) {
  const ts = tuples(row, name, owner);
  assert.strictEqual(ts.length, 1, name + ' must have one target');
  return ts[0][ts[0].length - 1];
}

describe('Relationalization boundary audit: released Core 6.0.1', function () {
  this.timeout(10 * 60 * 1000);
  let session, currentContext, setupError;
  const captures = [], checks = [], contexts = [];
  let plannedChecks = [];
  before(async function () {
    plannedChecks = this.test.parent.tests.map(t => t.title);
    try {
      session = await start();
      assert.strictEqual(session.metadata.coreVersion, '6.0.1', 'Re-audit after changing Core');
      await initialize('original', PRELUDE);
    } catch (e) { setupError = String(e); throw e; }
  });
  afterEach(function () {
    checks.push({ name: this.currentTest.title, state: this.currentTest.state,
      error: this.currentTest.err && this.currentTest.err.message });
  });
  after(async function () {
    try {
      const file = process.env.RELATIONALIZATION_REPORT || path.resolve(__dirname, '../../build/relationalization-audit.json');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({
        protocol: 'spyret-relationalization-audit-v1',
        claim: 'Characterization, including known losses; not a full-fidelity certificate',
        generatedAt: new Date().toISOString(), metadata: session && session.metadata,
        setupError, plannedChecks, contexts, checks, captures,
        auditChecksHold: !setupError && checks.length === plannedChecks.length
          && plannedChecks.length > 0 && checks.every(c => c.state === 'passed'),
      }, null, 2) + '\n');
      console.log('\n  Boundary evidence: ' + file);
    } finally { if (session) await session.close(); }
  });

  async function initialize(id, prelude) {
    const result = await session.ide.page.evaluate(p => window.__reifyFidelity.init(p), prelude);
    contexts.push({ id, prelude, ...result });
    assert.ok(result.ok, result.error);
    currentContext = id;
  }

  async function capture(id, expr) {
    const row = await session.ide.page.evaluate(e => window.__reifyFidelity.captureWorkingCase(e), expr);
    captures.push({ id, expr, context: currentContext, ...row });
    assert.strictEqual(row.verdict, 'captured', JSON.stringify(row));
    assert.ok(!Object.prototype.hasOwnProperty.call(row, 'A'), 'No printer in this path');
    // Transport only JSON and an explicit observation root. The receiver gets
    // neither source, live objects, declaration context, nor a producer cache.
    const received = await session.ide.decoder.evaluate(json => {
      const core = window.spytialcore;
      core.PyretDataInstance.clearGlobalConstructorCache();
      const packet = JSON.parse(json);
      packet.datum.atoms.reverse();
      packet.datum.relations.reverse();
      const fresh = new core.JSONDataInstance(packet.datum);
      if (fresh.getErrors().length) throw new Error(fresh.getErrors().join('; '));
      return { rootId: packet.rootId, datum: {
        atoms: fresh.getAtoms(), relations: fresh.getRelations(), types: fresh.getTypes(),
      } };
    }, JSON.stringify({ datum: row.datum, rootId: row.rootId }));
    assert.deepStrictEqual([...received.datum.atoms].sort((a, b) => a.id.localeCompare(b.id)),
      [...row.datum.atoms].sort((a, b) => a.id.localeCompare(b.id)));
    atom(received, received.rootId);
    return received;
  }

  it('captures declared fields even when _output throws, without an evaluator', async function () {
    const r = await capture('hidden-fields', 'hidden(1, 999)');
    assert.strictEqual(atom(r, target(r, 'secret')).label, '999');
    assert.strictEqual(atom(r, target(r, 'visible')).label, '1');
  });

  it('preserves declaration order in field relation IDs after transport and reordering', async function () {
    const r = await capture('field-order', 'ordered(9, 2)');
    const fields = r.datum.relations.filter(rel => rel.id.startsWith('pyret:field:v1:'))
      .map(rel => JSON.parse(rel.id.slice('pyret:field:v1:'.length))).sort((a, b) => a[1] - b[1]);
    assert.deepStrictEqual(fields, [['ordered', 0, 'zebra'], ['ordered', 1, 'alpha']]);
    assert.strictEqual(atom(r, target(r, 'zebra')).label, '9');
  });

  it('distinguishes shared from equal-but-distinct children', async function () {
    const shared = await capture('shared', 'block:\n p = point(1, 2)\n pair(p, p)\nend');
    const separate = await capture('separate', 'pair(point(1, 2), point(1, 2))');
    assert.strictEqual(target(shared, 'fst'), target(shared, 'snd'));
    assert.notStrictEqual(target(separate, 'fst'), target(separate, 'snd'));
  });

  it('preserves exact numeric payloads and the exact/rough distinction', async function () {
    const r = await capture('numbers', '[raw-array: 1/3, 123456789012345678901234567890, 1, ~1]');
    const elements = tuples(r, 'element').sort((a, b) => Number(atom(r, a[1]).label) - Number(atom(r, b[1]).label));
    assert.deepStrictEqual(elements.map(t => atom(r, t[2]).label), ['1/3', '123456789012345678901234567890', '1', '~1']);
    assert.notStrictEqual(elements[2][2], elements[3][2]);
  });

  it('preserves repeated sequence positions and container kinds', async function () {
    for (const [id, expr, kind] of [['array', '[raw-array: 1, 1]', 'RawArray'], ['tuple', '{1; 1}', 'Tuple']]) {
      const r = await capture(id, expr);
      assert.strictEqual(atom(r, r.rootId).type, kind);
      const elements = tuples(r, 'element');
      assert.strictEqual(elements.length, 2);
      assert.deepStrictEqual(elements.map(t => atom(r, t[1]).label).sort(), ['0', '1']);
      assert.strictEqual(elements[0][2], elements[1][2]);
    }
  });

  it('distinguishes nothing, empty objects, singletons, and nullary applications', async function () {
    const n = await capture('nothing', 'nothing');
    const o = await capture('empty-object', '{}');
    const s = await capture('singleton', 'empty-variant');
    const z = await capture('nullary', 'zero()');
    assert.strictEqual(atom(n, n.rootId).type, 'Nothing');
    assert.strictEqual(atom(o, o.rootId).type, 'Object');
    assert.strictEqual(tuples(s, 'nullary-constructor').length, 0);
    assert.strictEqual(tuples(z, 'nullary-constructor').length, 1);
  });

  it('preserves mutable field position, reference identity, and a cycle to the selected root', async function () {
    const r = await capture('ref-cycle', 'block:\n c = cell(nothing)\n c!{next: c}\n c\nend');
    const ref = target(r, 'next');
    assert.strictEqual(atom(r, ref).type, 'Reference');
    assert.strictEqual(target(r, 'target', ref), r.rootId);
    assert.strictEqual(atom(r, target(r, 'mutable-field')).label, '0');
    assert.strictEqual(tuples(r, 'unrestricted', ref).length, 1);
    assert.ok(!Object.prototype.hasOwnProperty.call(r.datum, 'rootId'));
  });

  it('preserves dictionary entry positions and sharing independently of source emission', async function () {
    const r = await capture('dictionary-sharing', 'block:\n a = [raw-array: 1]\n [string-dict: "a", a, "b", a]\nend');
    const entries = tuples(r, 'entry');
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0][3], entries[1][3]);
    assert.strictEqual(atom(r, entries[0][3]).type, 'RawArray');
    assert.deepStrictEqual(entries.map(t => atom(r, t[2]).label).sort(), ['a', 'b']);
  });

  it('preserves ordered table headers and duplicate row occurrences', async function () {
    const r = await capture('table', 'table: zebra, alpha row: 1, 2 row: 1, 2 end');
    const columns = tuples(r, 'column').sort((a, b) => Number(atom(r, a[1]).label) - Number(atom(r, b[1]).label));
    assert.deepStrictEqual(columns.map(t => atom(r, t[2]).label), ['zebra', 'alpha']);
    const rows = tuples(r, 'row');
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows[0].slice(2), rows[1].slice(2));
    assert.notStrictEqual(rows[0][1], rows[1][1]);
  });

  // Deliberate baseline-loss witnesses. Passing these documents a gap in 6.0.1;
  // it does not claim desired fidelity. Replace them when Core fixes the loss.
  it('[known loss] different nominal constructors with the same spelling export identically', async function () {
    const left = await capture('nominal-left', 'left-type.make(1)');
    // A fresh declaration supplies a different constructor with the same name,
    // shape, and contents. The live identity witness stays on the producer.
    await initialize('other-nominal-type',
      PRELUDE.replace('data Local:', 'data Other:').replace('is-Local', 'is-Other'));
    const right = await capture('nominal-right', 'left-type.make(1)');
    const a = captures.find(r => r.id === 'nominal-left').inputObservation;
    const b = captures.find(r => r.id === 'nominal-right').inputObservation;
    assert.notStrictEqual(a.constructorIdentity, b.constructorIdentity);
    assert.notDeepStrictEqual(a.brands, b.brands);
    assert.deepStrictEqual(left, right, 'Update the audit if nominal identity begins surviving');
  });

  it('[known loss] a function-valued object field disappears without a diagnostic', async function () {
    const withFunction = await capture('function-field', '{f: lam(x): x end}');
    const empty = await capture('function-field-empty', '{}');
    assert.deepStrictEqual(withFunction, empty, 'Update the audit when omissions become explicit');
  });
});
