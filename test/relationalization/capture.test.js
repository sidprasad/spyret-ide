'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const fc = require('fast-check');
const { start } = require('../pyret-round-trip/harness');
const { PRELUDE, ROWS, arbitraries } = require('../reify-fidelity/corpus');
const { schemaArbitrary } = require('../constructor-data/corpus');

const NUM_RUNS = Number(process.env.REIFY_FUZZ_RUNS || 100);
const SEED = Number(process.env.REIFY_SEED || 1);
if (!Number.isSafeInteger(NUM_RUNS) || NUM_RUNS < 1 || !Number.isInteger(SEED)) {
  throw new Error('REIFY_FUZZ_RUNS must be positive and REIFY_SEED must be an integer');
}

// A fresh realm has no window, document, Pyret runtime, REPL or producer caches.
const consumer = vm.createContext({});
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../lib/js/spytial-pyret-capture.js'), 'utf8'), consumer);
const api = consumer.Spyret;

describe('Portable capture used by Spyret-IDE', function () {
  this.timeout(10 * 60 * 1000);
  let session;
  before(async function () {
    session = await start();
    assert.strictEqual(await session.ide.page.evaluate(() => typeof window.__internalRepl.runtime.ffi.isVSConstrRender),
      'undefined', 'Portable capture PBTs must use the standard backend, not the Spyret fork');
    const result = await session.ide.page.evaluate(p => window.__reifyFidelity.init(p), PRELUDE);
    assert.ok(result.ok, result.error);
    assert.strictEqual(await session.ide.page.evaluate(() => typeof window.Spyret.capturePyret), 'function');
  });
  after(async function () { if (session) await session.close(); });

  async function capture(expr) {
    const result = await session.ide.page.evaluate(e => window.__reifyFidelity.capturePortableCase(e), expr);
    assert.strictEqual(result.verdict, 'captured', JSON.stringify(result));
    return api.importPyretCapture(JSON.parse(JSON.stringify(result.snapshot)));
  }

  async function checkRoundTrip(expr, prelude) {
    const initialized = await session.ide.page.evaluate(p => window.__reifyFidelity.init(p), prelude);
    assert.ok(initialized.ok, initialized.error);
    const result = await session.ide.page.evaluate(e => window.__reifyFidelity.capturePortableCase(e), expr);
    assert.strictEqual(result.verdict, 'captured', JSON.stringify(result));
    // The headless consumer receives neither source nor the expected output.
    for (const root of result.snapshot.roots) delete root.observation;
    const { snapshot, instance } = api.importPyretCapture(JSON.parse(JSON.stringify(result.snapshot)));
    const source = api.pyretCaptureSource(instance, snapshot.roots[0].atomId);
    const expected = await session.ide.page.evaluate(e => window.__reifyFidelity.inspectExpression(e), expr);
    assert.strictEqual(expected.verdict, 'inspected', JSON.stringify(expected));
    const decoder = session.ide.decoder;
    const ready = await decoder.evaluate(p => window.__reifyFidelity.init(p), prelude);
    assert.ok(ready.ok, ready.error);
    const actual = await decoder.evaluate(e => window.__reifyFidelity.inspectExpression(e), source);
    assert.strictEqual(actual.verdict, 'inspected', JSON.stringify({ source, ...actual }));
    assert.strictEqual(actual.B, expected.B, `Expression: ${expr}\nReconstructed: ${source}`);
    const checked = await decoder.evaluate((a, b) => window.__reifyFidelity.checkStrings(a, b), expected.B, actual.B);
    assert.strictEqual(checked.verdict, 'pass', JSON.stringify(checked));
    assert.deepStrictEqual(checked.check, { blocks: 1, results: ['success'], errors: 0 });
  }

  for (const row of ROWS.filter(row => row.expect === 'supported')) {
    it(`imports ${row.category}/${row.name} without a producing runtime`, async function () {
      const { snapshot, values } = await capture(row.expr);
      assert.strictEqual(snapshot.roots[0].name, 'value');
      assert.strictEqual(snapshot.roots[0].observation.expression, row.expr);
      assert.ok(values.has('value'));
    });
  }

  it('retains structural sharing in a headless consumer', async function () {
    const { values } = await capture('block:\n a = [raw-array: 1]\n [string-dict: "a", a, "b", a]\nend');
    const dict = values.get('value');
    assert.strictEqual(dict.entries[0][1], dict.entries[1][1]);
  });

  it('reports a nested unsupported value with its root and path', async function () {
    const result = await session.ide.page.evaluate(() => window.__reifyFidelity.capturePortableCase('{items: [raw-array: lam(x): x end]}'));
    assert.strictEqual(result.verdict, 'capture-error');
    assert.strictEqual(result.root, 'value');
    assert.deepStrictEqual(result.path, ['items', 0]);
    assert.match(result.reason, /function/);
  });

  it(`${NUM_RUNS} generated values preserve Pyret inspection through portable capture (seed ${SEED})`, async function () {
    await fc.assert(fc.asyncProperty(arbitraries(fc).value, expr => checkRoundTrip(expr, PRELUDE)),
      { numRuns: NUM_RUNS, seed: SEED, verbose: true });
  });

  it(`20 generated declarations preserve field order and constructor kind (seed ${SEED})`, async function () {
    const schemas = schemaArbitrary(fc).chain(schema => schema.value.map(expr =>
      ({ prelude: schema.prelude, expressions: [...schema.witnesses, expr] })));
    await fc.assert(fc.asyncProperty(schemas, async ({ prelude, expressions }) => {
      for (const expr of expressions) await checkRoundTrip(expr, prelude);
    }), { numRuns: 20, seed: SEED, verbose: true });
  });

  it('the actual display module captures without consulting the REPL and preserves the selected root', async function () {
    const initialized = await session.ide.page.evaluate(() => window.__reifyFidelity.init('import spytial as SP\ndata Cell: cell(ref next) end'));
    assert.ok(initialized.ok, initialized.error);
    // The helper closes over the evaluator needed to obtain a live fixture.
    // The display module itself must not consult the browser REPL global.
    const result = await session.ide.page.evaluate(async () => {
      const saved = window.__internalRepl;
      window.__internalRepl = undefined;
      try { return await window.__reifyFidelity.renderExpression('block:\n c = cell(nothing)\n c!{next: c}\n c\nend'); }
      finally { window.__internalRepl = saved; }
    });
    assert.strictEqual(result.verdict, 'rendered', JSON.stringify(result));
    assert.ok(result.R.includes('!{'), 'The source preview reconstructs the supported reference cycle');
    assert.ok(!result.R.includes('pyret:constructor:'), 'Source uses the display spelling, not a nominal token');
    assert.ok(result.snapshot && result.snapshot.roots[0].atomId);
    const { values } = api.importPyretCapture(result.snapshot);
    const cell = values.get('value');
    assert.strictEqual(cell.dict.next.value, cell);
  });
});
