'use strict';
const assert = require('assert');
const { summarize } = require('./report');
const { runCase } = require('./harness');

describe('Working round-trip report validity', function () {
  it('requires every planned case to succeed exactly once', function () {
    assert.strictEqual(summarize(['a'], [{ id: 'a', verdict: 'pass' }]).fidelityHolds, true);
    for (const rows of [[], [{ id: 'b', verdict: 'pass' }],
      [{ id: 'a', verdict: 'pass' }, { id: 'a', verdict: 'pass' }]]) {
      assert.strictEqual(summarize(['a'], rows).fidelityHolds, false);
    }
    assert.strictEqual(summarize([], []).fidelityHolds, false);
  });
  it('does not turn recorded baseline gaps into fidelity successes', function () {
    const r = summarize(['a'], [{ id: 'a', verdict: 'mismatch' }]);
    assert.strictEqual(r.complete, true);
    assert.strictEqual(r.fidelityHolds, false);
  });
  it('does not substitute shrink attempts for missing planned cases', function () {
    assert.strictEqual(summarize(['a', 'b'], [
      { id: 'a', verdict: 'pass' }, { id: 'shrink-0', verdict: 'pass' },
    ]).fidelityHolds, false);
  });
  it('fails a complete-looking run when an orchestration error occurred', function () {
    assert.strictEqual(summarize(['a'], [{ id: 'a', verdict: 'pass' }], ['initialization failed']).fidelityHolds, false);
  });
  it('records initialization failure instead of losing its row', async function () {
    const session = { ide: { page: { evaluate: async () => { throw new Error('init failed'); } } } };
    const row = await runCase(session, { id: 'a', expr: '1', prelude: 'nothing' });
    assert.strictEqual(row.id, 'a');
    assert.strictEqual(row.verdict, 'harness-error');
    assert.strictEqual(row.stage, 'producer-init');
    assert.strictEqual(summarize(['a'], [row]).fidelityHolds, false);
  });
  it('passes only JSON to reification, and declarations only afterward', async function () {
    const calls = [];
    const datum = { atoms: [], relations: [], types: [] };
    function fake(label, replies) {
      return { evaluate: async (fn, ...args) => { calls.push({ label, fn: String(fn), args }); return replies.shift(); } };
    }
    const page = fake('producer', [{ ok: true }, { verdict: 'exported', A: 'original-print', datum },
      { verdict: 'pass', check: { blocks: 1, errors: 0, results: ['success'] } }]);
    const decoder = fake('decoder', [{ ok: true }, { verdict: 'reified', R: 'recovered()' },
      { ok: true }, { verdict: 'inspected', B: 'original-print' }]);
    const row = await runCase({ ide: { page, decoder } }, { id: 'a', expr: 'original()', prelude: 'DECLARATIONS' });
    assert.strictEqual(row.verdict, 'pass');
    assert.deepStrictEqual(calls[2].args, ['nothing']);
    assert.deepStrictEqual(calls[3].args, [JSON.stringify(datum)]);
    assert.deepStrictEqual(calls[4].args, ['DECLARATIONS']);
    assert.deepStrictEqual(calls[5].args, ['recovered()']);
    assert.deepStrictEqual(calls[6].args, ['original-print', 'original-print']);
  });
});
