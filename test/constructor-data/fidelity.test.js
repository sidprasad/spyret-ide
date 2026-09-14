'use strict';

const assert = require('assert');
const path = require('path');
const { fixtures } = require('./corpus');
const { start, runCase } = require('./harness');
const { writeReport } = require('./report');

// This is a regression baseline, NOT an assertion that fidelity holds for all
// these inputs. The separate measurement command exits nonzero on ANY gap.
const BASELINE = {
  'integer-zero': 'mismatch', 'integer-min': 'relationalize-error',
  'integer-max': 'relationalize-error', 'boolean-true': 'relationalize-error',
  'boolean-false': 'mismatch', 'empty-string': 'mismatch',
  escaping: 'relationalize-error', unicode: 'relationalize-error',
  'zero-constructor': 'mismatch', 'different-leaf-types': 'mismatch', 'field-order': 'mismatch',
  'tree-recursive': 'reify-eval-error', expression: 'mismatch',
  'mutual-base': 'reify-eval-error', 'mutual-recursive': 'reify-eval-error',
  'shared-subtree': 'reify-eval-error', 'equal-distinct-subtrees': 'reify-eval-error',
  'additional-constructor': 'mismatch',
};

describe('Spyret working relationalizer/reifier: recorded 4.4.3 baseline', function () {
  this.timeout(30 * 60 * 1000);
  const cases = fixtures();
  const rows = [], errors = [];
  let session;
  before(async function () {
    try {
      session = await start();
      assert.strictEqual(session.metadata.coreVersion, '4.4.3', 'Re-measure the baseline after a core upgrade');
    } catch (e) { errors.push(String(e)); throw e; }
  });
  afterEach(function () {
    if (this.currentTest.state === 'failed') errors.push(this.currentTest.title);
  });
  after(async function () {
    try { if (session) await session.close(); } catch (e) { errors.push(String(e)); throw e; }
    finally {
      const file = process.env.CONSTRUCTOR_REPORT || path.resolve(__dirname, '../../build/constructor-data-report.json');
      const report = writeReport(file, cases, rows, session ? session.metadata : {}, errors);
      console.log(`\n  Actual fidelity: ${report.summary.passed}/${report.summary.total}; fidelityHolds=${report.summary.fidelityHolds}`);
      console.log(`  ${file}\n`);
      assert.ok(report.summary.complete, 'Incomplete or failed regression run');
    }
  });

  for (const fixture of cases) {
    const expected = BASELINE[fixture.id] || 'pass';
    it(`${fixture.id} [${expected === 'pass' ? 'exact match' : 'known gap: ' + expected}]`, async function () {
      const row = await runCase(session, fixture);
      rows.push(row);
      assert.strictEqual(row.verdict, expected, JSON.stringify(row));
      if (row.verdict === 'pass' || row.verdict === 'mismatch') {
        assert.deepStrictEqual(row.check, { blocks: 1, results: [expected === 'pass' ? 'success' : 'failure-not-equal'], errors: 0 });
      }
    });
  }

  it('uses real Pyret checks for matches and mismatches, including escaped strings', async function () {
    for (const [a, b, expected] of [['é\n"\\\0', 'é\n"\\\0', 'pass'], ['same', 'different', 'mismatch']]) {
      const r = await session.ide.page.evaluate((x, y) => window.__reifyFidelity.checkStrings(x, y), a, b);
      assert.strictEqual(r.verdict, expected, JSON.stringify(r));
    }
  });
  it('clears poisoned reifier caches before reconstructing the serialized datum', async function () {
    const row = rows.find(r => r.id === 'field-order');
    assert.ok(row && row.datum);
    const replay = JSON.parse(JSON.stringify(row.datum));
    replay.relations.reverse();
    await session.ide.decoder.evaluate(() => {
      new window.spytialcore.PyretDataInstance({ $name: 'duo', dict: { zebra: 0, alpha: 0 } });
    });
    const r = await session.ide.decoder.evaluate(d => window.__reifyFidelity.reifyWorkingDatum(d), replay);
    assert.strictEqual(r.verdict, 'reified', JSON.stringify(r));
    assert.strictEqual(r.R, row.R);
    assert.strictEqual(r.R, 'duo(2, 9)'); // exposes the gap rather than repairing it in the test
  });
});
