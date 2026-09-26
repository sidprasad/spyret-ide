'use strict';

const assert = require('assert');
const vm = require('vm');
const { runCase, runObservation, replayDatum } = require('./harness');
const { pageRuntime } = require('./browser');

function fakePage(label, replies, calls) {
  return { evaluate: async (fn, ...args) => {
    calls.push({ label, fn: String(fn), args });
    assert.ok(replies.length, 'Unexpected browser call');
    return replies.shift();
  } };
}

describe('Shared datum-only harness contract', function () {
  it('records initialization failure instead of losing its row', async function () {
    const session = { ide: { page: { evaluate: async () => { throw new Error('init failed'); } } } };
    const row = await runCase(session, { id: 'a', expr: '1', prelude: 'nothing' });
    assert.strictEqual(row.id, 'a');
    assert.strictEqual(row.verdict, 'harness-error');
    assert.strictEqual(row.stage, 'producer-init');
  });

  it('passes only JSON and a root ID to reification, and declarations only afterward', async function () {
    const calls = [];
    const datum = { atoms: [], relations: [], types: [] };
    const page = fakePage('producer', [{ ok: true }, { verdict: 'exported', A: 'original-print', datum, rootId: 'selected' },
      { verdict: 'pass', check: { blocks: 1, errors: 0, results: ['success'] } }], calls);
    const decoder = fakePage('decoder', [{ ok: true }, { verdict: 'reified', R: 'recovered()' },
      { ok: true }, { verdict: 'inspected', B: 'original-print' }], calls);
    const row = await runCase({ ide: { page, decoder } }, { id: 'a', expr: 'original()', prelude: 'DECLARATIONS' });
    assert.strictEqual(row.verdict, 'pass');
    assert.deepStrictEqual(calls.map(c => c.label), ['producer', 'producer', 'decoder', 'decoder', 'decoder', 'decoder', 'producer']);
    assert.deepStrictEqual(calls[0].args, ['DECLARATIONS']);
    assert.deepStrictEqual(calls[1].args, ['original()']);
    assert.deepStrictEqual(calls[2].args, ['nothing']);
    assert.deepStrictEqual(calls[3].args, [JSON.stringify(datum), 'selected']);
    assert.deepStrictEqual(calls[4].args, ['DECLARATIONS']);
    assert.deepStrictEqual(calls[5].args, ['recovered()']);
    assert.deepStrictEqual(calls[6].args, ['original-print', 'original-print']);
  });

  it('reports a content mismatch separately from a passing table inspection marker', async function () {
    const calls = [];
    const check = { blocks: 1, errors: 0, results: ['success'] };
    const page = fakePage('producer', [{ ok: true },
      { verdict: 'exported', A: '<table>', datum: {}, rootId: 'table-root' },
      { verdict: 'pass', check }, { ok: true }, { verdict: 'inspected', B: '[list: 1]' },
      { verdict: 'mismatch', check: { ...check, results: ['failure-not-equal'] } }], calls);
    const decoder = fakePage('decoder', [{ ok: true }, { verdict: 'reified', R: 'recovered-table' },
      { ok: true }, { verdict: 'inspected', B: '<table>' },
      { ok: true }, { verdict: 'inspected', B: '[list: 2]' }], calls);
    const row = await runObservation({ ide: { page, decoder } },
      { expr: 'original-table', prelude: 'DECLARATIONS', observe: 'contents' });
    assert.strictEqual(row.inspection.verdict, 'pass');
    assert.strictEqual(row.verdict, 'mismatch');
    assert.strictEqual(row.stage, 'observation-check');
    assert.strictEqual(row.A, '[list: 1]');
    assert.strictEqual(row.B, '[list: 2]');
    assert.deepStrictEqual(calls[3].args, ['{}', 'table-root']);
    assert.deepStrictEqual(calls[8].args, ['(contents)(original-table)']);
    assert.deepStrictEqual(calls[10].args, ['(contents)(recovered-table)']);
  });

  it('does not load declarations or evaluate after reification fails', async function () {
    const calls = [];
    const decoder = fakePage('decoder', [{ ok: true }, { verdict: 'reify-error', error: 'invalid datum' }], calls);
    const row = await replayDatum({ ide: { decoder } }, { atoms: [], relations: [], types: [] }, 'DECLARATIONS');
    assert.strictEqual(row.verdict, 'reify-error');
    assert.strictEqual(row.stage, 'reify');
    assert.strictEqual(calls.length, 2);
  });

  it('rejects a Pyret check result that contradicts exact string equality', async function () {
    const calls = [];
    const page = fakePage('producer', [{ ok: true }, { verdict: 'exported', A: 'a', datum: {} },
      { verdict: 'pass' }], calls);
    const decoder = fakePage('decoder', [{ ok: true }, { verdict: 'reified', R: 'recovered()' },
      { ok: true }, { verdict: 'inspected', B: 'b' }], calls);
    const row = await runCase({ ide: { page, decoder } }, { expr: 'original()', prelude: 'DECLARATIONS' });
    assert.strictEqual(row.verdict, 'harness-error');
    assert.strictEqual(row.stage, 'pyret-check');
  });
});

// Execute the actual browser helper in a separate realm with instrumented core
// boundaries. This tests invocation/isolation, not a fake implementation of
// Pyret fidelity (the browser integration tests establish that).
function browserFixture(value) {
  const calls = [], cache = new Map([['poison', true]]);
  const rt = { isSuccessResult: () => true, getField: (v, field) => v[field],
    toReprJS: () => { calls.push({ kind: 'print' }); return 'reference-print'; }, ReprMethods: { _torepr: '_torepr' } };
  const repl = { runtime: rt, run: async expr => {
    calls.push({ kind: 'run', expr });
    return { result: { dict: { v: { val: { runtime: rt, result: { result: { answer: value } } } } },
      brands: { $brandright: true } } };
  } };
  const datum = { atoms: [{ id: 'a', type: 'test', label: 'test' }], relations: [], types: [] };
  class PDI {
    constructor(...args) { calls.push({ kind: 'relationalize', args }); cache.set('producer', true); }
    static clearGlobalConstructorCache() { calls.push({ kind: 'clear' }); cache.clear(); }
    getAtoms() { return datum.atoms; }
    getRelations() { return datum.relations; }
    getTypes() { return datum.types; }
    reify(rootId) {
      calls.push({ kind: 'reify', rootId });
      assert.strictEqual(cache.size, 0, 'No seeded constructor cache may reach reification');
      assert.ok(this instanceof JSONDI, 'Reifier must operate on a fresh JSON instance');
      return 'recovered()';
    }
  }
  class JSONDI {
    constructor(...args) { calls.push({ kind: 'normalize', args }); this.datum = args[0]; }
    getAtoms() { return this.datum.atoms; }
    getRelations() { return this.datum.relations; }
    getTypes() { return this.datum.types; }
    getErrors() { return []; }
  }
  const window = { __internalRepl: repl, Spyret: { PyretDataInstance: PDI }, spytialcore: { JSONDataInstance: JSONDI } };
  vm.runInNewContext(`(${pageRuntime.toString()})()`, { window });
  return { api: window.__reifyFidelity, repl, calls, cache, datum };
}

describe('Shared browser boundary contract', function () {
  it('captures a live value without passing an evaluator or invoking its printer', async function () {
    const value = { dict: { hidden: 17 } };
    const f = browserFixture(value);
    const row = await f.api.captureWorkingCase('SOURCE');
    assert.strictEqual(row.verdict, 'captured');
    assert.strictEqual(row.rootId, 'a');
    assert.deepStrictEqual(f.calls.find(c => c.kind === 'relationalize').args, [value]);
    assert.ok(!f.calls.some(c => c.kind === 'print'));
    assert.strictEqual(f.cache.size, 0);
  });
  for (const value of [0, false, '', { dict: { field: 1 } }]) {
    it(`passes ${JSON.stringify(value)} directly to the production relationalizer`, async function () {
      const f = browserFixture(value);
      const row = await f.api.exportWorkingCase('SOURCE');
      assert.strictEqual(row.verdict, 'exported');
      assert.strictEqual(row.rootId, 'a');
      assert.deepStrictEqual(Object.keys(row.datum).sort(), ['atoms', 'relations', 'types']);
      const calls = f.calls.filter(c => c.kind === 'relationalize');
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].args.length, 3);
      assert.strictEqual(calls[0].args[0], value);
      assert.strictEqual(JSON.stringify(calls[0].args[1]), '{}');
      assert.strictEqual(calls[0].args[2], f.repl);
      assert.deepStrictEqual(f.calls.filter(c => c.kind === 'run').map(c => c.expr), ['SOURCE']);
      assert.strictEqual(f.cache.size, 0);
    });
  }

  it('uses default JSON normalization with an empty cache and no synthetic constructors', function () {
    const f = browserFixture();
    const row = f.api.reifyWorkingDatum(f.datum, 'a');
    assert.strictEqual(row.verdict, 'reified');
    assert.strictEqual(f.calls.find(c => c.kind === 'reify').rootId, 'a');
    assert.deepStrictEqual(f.calls.map(c => c.kind), ['clear', 'normalize', 'reify', 'clear']);
    assert.deepStrictEqual(f.calls.find(c => c.kind === 'normalize').args, [f.datum]);
    assert.strictEqual(f.cache.size, 0);
    assert.strictEqual(f.api.exportCase, undefined, 'Legacy adapter entry point must stay removed');
    assert.strictEqual(f.api.decode, undefined, 'Legacy schema-seeding entry point must stay removed');
  });
});
