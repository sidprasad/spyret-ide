'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { start } = require('../pyret-round-trip/harness');
const { PRELUDE, ROWS } = require('../reify-fidelity/corpus');

// A fresh realm has no window, document, Pyret runtime, REPL or producer caches.
const consumer = vm.createContext({});
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../lib/js/spytial-pyret-capture.js'), 'utf8'), consumer);
const api = consumer.SpytialPyretCapture;

describe('Portable capture used by Spyret-IDE', function () {
  this.timeout(10 * 60 * 1000);
  let session;
  before(async function () {
    session = await start();
    const result = await session.ide.page.evaluate(p => window.__reifyFidelity.init(p), PRELUDE);
    assert.ok(result.ok, result.error);
    assert.strictEqual(await session.ide.page.evaluate(() => typeof window.SpytialPyretCapture.capturePyret), 'function');
  });
  after(async function () { if (session) await session.close(); });

  async function capture(expr) {
    const result = await session.ide.page.evaluate(e => window.__reifyFidelity.capturePortableCase(e), expr);
    assert.strictEqual(result.verdict, 'captured', JSON.stringify(result));
    return api.importPyretCapture(JSON.parse(JSON.stringify(result.snapshot)));
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

  it('the actual display module captures without consulting the REPL and preserves the selected root', async function () {
    const initialized = await session.ide.page.evaluate(() => window.__reifyFidelity.init('import dom-render as DR\ndata Cell: cell(ref next) end'));
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
