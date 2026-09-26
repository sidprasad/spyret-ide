'use strict';

const assert = require('assert');
const path = require('path');
const { fixtures } = require('./corpus');
const { start, runCase } = require('../pyret-round-trip/harness');
const { writeReport } = require('./report');

describe('Spyret working relationalizer/reifier: released 6.3.2', function () {
  this.timeout(30 * 60 * 1000);
  const cases = fixtures();
  const rows = [], errors = [];
  let session;
  before(async function () {
    try {
      session = await start();
      assert.strictEqual(session.metadata.coreVersion, '6.3.2', 'Re-measure after a core upgrade');
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
      assert.ok(report.summary.fidelityHolds, 'Every planned fixture must round-trip exactly');
    }
  });

  for (const fixture of cases) {
    it(`${fixture.id} [exact match]`, async function () {
      const row = await runCase(session, fixture);
      rows.push(row);
      assert.strictEqual(row.verdict, 'pass', JSON.stringify(row));
      assert.deepStrictEqual(row.check, { blocks: 1, results: ['success'], errors: 0 });
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
    const r = await session.ide.decoder.evaluate((d, root) => window.__reifyFidelity.reifyWorkingDatum(d, root), replay, row.rootId);
    assert.strictEqual(r.verdict, 'reified', JSON.stringify(r));
    assert.strictEqual(r.R, row.R);
    assert.strictEqual(r.R, 'duo(9, 2)');
  });

  it('renders a constructor datum with the released evaluator and graph component', async function () {
    const datum = rows.find(r => r.id === 'same-field-different-position').datum;
    const rendered = await session.ide.page.evaluate(async d => {
      const core = window.spytialcore;
      const data = new core.JSONDataInstance(d);
      const evaluator = new core.Evaluators.SGraphQueryEvaluator();
      evaluator.initialize({ sourceData: data });
      const spec = core.parseLayoutSpec('constraints: []\ndirectives: []');
      const result = new core.LayoutInstance(spec, evaluator, 0, true).generateLayout(data);
      const graph = document.createElement('webcola-cnd-graph');
      graph.setAttribute('width', '400');
      graph.setAttribute('height', '400');
      document.body.appendChild(graph);
      try {
        await graph.renderLayout(result.layout);
        return { nodes: result.layout.nodes.length,
          renderedNodes: graph.shadowRoot.querySelectorAll('g.node').length };
      } finally { graph.remove(); }
    }, datum);
    assert.ok(rendered.nodes > 0);
    assert.strictEqual(rendered.renderedNodes, rendered.nodes);
  });
});
