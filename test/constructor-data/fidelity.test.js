'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fc = require('fast-check');
const { ensureServer, openIde, pageRuntime } = require('../reify-fidelity/harness');
const { inspectDatum } = require('../../src/web/js/pyret-constructor-datum');
const { PRELUDE, CASES, REJECTED, arbitraries, schemaArbitrary } = require('./corpus');

const RUNS = Number(process.env.CONSTRUCTOR_RUNS || 30); // per family
const SEED = Number(process.env.CONSTRUCTOR_SEED || 1);
const SCHEMAS = 10;
const SCHEMA_SAMPLES = 10;
if (!Number.isInteger(RUNS) || RUNS < 1 || !Number.isInteger(SEED)) {
  throw new Error('CONSTRUCTOR_RUNS must be positive and CONSTRUCTOR_SEED must be an integer');
}
const REPORT = process.env.CONSTRUCTOR_REPORT || path.resolve(__dirname, '../../build/constructor-data-report.json');

describe('Pyret constructor-data: torepr(value) == inspect(Spytial datum)', function () {
  this.timeout(30 * 60 * 1000);
  let server, ide, coreVersion;
  const rows = [];
  const schemas = [];
  let activePrelude = PRELUDE;
  let finished = false;
  async function init(prelude) {
    const result = await ide.page.evaluate(p => window.__reifyFidelity.init(p, {}), prelude);
    assert.ok(result.ok, result.error);
  }
  async function check(expr, name, group, expectedReason) {
    // Each fixture is an independent program. Do not accumulate hundreds of
    // interaction environments in the self-hosted compiler between samples.
    await init(activePrelude);
    const row = await ide.page.evaluate(e => window.__reifyFidelity.exportConstructorCase(e), expr);
    Object.assign(row, { expr, name, group });
    rows.push(row);
    if (expectedReason) {
      row.expectedReason = expectedReason;
      assert.strictEqual(row.verdict, 'rejected', JSON.stringify(row));
      assert.strictEqual(row.reason, expectedReason, JSON.stringify(row));
      return;
    }
    assert.strictEqual(row.verdict, 'exported', JSON.stringify(row));

    // The browser receives only JSON here, not A, expr or any source object.
    // Exercise the real Spytial JSON importer with DEFAULT normalization.
    const received = await ide.page.evaluate(json => {
      const di = new window.spytialcore.JSONDataInstance(JSON.parse(json));
      if (di.getErrors && di.getErrors().length) throw new Error(di.getErrors().join('; '));
      return { atoms: di.getAtoms(), relations: di.getRelations(), types: di.getTypes() };
    }, JSON.stringify(row.datum));
    row.received = received;
    // These checks establish the structural guarantees as well as the weaker
    // printing observation: printing alone cannot distinguish shared/equal data.
    if (name === 'shared-subtree' || name === 'equal-distinct-subtrees') {
      const branchAtoms = received.atoms.filter(a => a.type === 'CDConstructor' && a.label === 'branch');
      assert.strictEqual(branchAtoms.length, name === 'shared-subtree' ? 1 : 2);
    }
    // Destroy enumeration order before decoding, including individual tuples.
    const replay = JSON.parse(JSON.stringify(received));
    replay.atoms.reverse(); replay.relations.reverse();
    replay.relations.forEach(r => r.tuples.reverse());
    // Node has no Pyret runtime, constructor definitions, or source-value cache.
    row.B = inspectDatum(replay);
    row.verdict = row.A === row.B ? 'pass' : 'mismatch';
    assert.strictEqual(row.B, row.A, JSON.stringify(row));
  }

  before(async function () {
    server = await ensureServer();
    ide = await openIde(server.baseUrl, 1);
    await ide.page.evaluate(pageRuntime);
    await ide.page.addScriptTag({ path: path.resolve(__dirname, '../../src/web/js/pyret-constructor-datum.js') });
    coreVersion = await ide.page.evaluate(() => window.__reifyFidelity.coreVersion());
    await init(PRELUDE);
  });

  after(async function () {
    try {
      const expected = CASES.length + REJECTED.length + RUNS * 5
        + schemas.reduce((n, s) => n + s.witnesses.length + SCHEMA_SAMPLES, 0);
      const complete = finished && schemas.length === SCHEMAS && rows.length === expected;
      const passed = rows.filter(r => r.verdict === 'pass').length;
      const rejected = rows.filter(r => r.verdict === 'rejected' && r.reason === r.expectedReason).length;
      const report = {
        model: 'pyret-constructor-data-v1', date: new Date().toISOString(),
        coreVersion, nodeVersion: process.version, browserVersion: ide && await ide.browser.version(),
        seed: SEED, runsPerFamily: RUNS, prelude: PRELUDE, schemas,
        summary: { complete, passed, rejected, total: rows.length,
          conforms: complete && passed + rejected === expected }, rows,
      };
      fs.mkdirSync(path.dirname(REPORT), { recursive: true });
      fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
      console.log(`\n  constructor data: ${passed} exact matches, ${rejected} explicit rejections; complete=${complete}\n  report: ${REPORT}`);
      assert.ok(report.summary.conforms, 'Incomplete or nonconforming constructor-data run');
    } finally {
      try { if (ide) await ide.browser.close(); }
      finally { if (server) server.stop(); }
    }
  });

  for (const c of CASES) {
    it(c.name, async function () { await check(c.expr, c.name, 'fixed'); });
  }
  for (const c of REJECTED) {
    it('rejects ' + c.name, async function () { await check(c.expr, c.name, 'rejected', c.reason); });
  }
  for (const [family, arb] of Object.entries(arbitraries(fc))) {
    it(`${RUNS} type-directed ${family} values (seed ${SEED})`, async function () {
      await fc.assert(fc.asyncProperty(arb, async expr => {
        await check(expr, family, 'generated');
      }), { seed: SEED, numRuns: RUNS, verbose: true });
    });
  }
  it(`${SCHEMAS} generated datatype declarations, every variant and ${SCHEMA_SAMPLES} samples each`, async function () {
    const generated = fc.sample(schemaArbitrary(fc), { seed: SEED, numRuns: SCHEMAS });
    for (let i = 0; i < generated.length; i++) {
      const s = generated[i];
      schemas.push({ prelude: s.prelude, witnesses: s.witnesses });
      activePrelude = s.prelude;
      for (const expr of s.witnesses) await check(expr, `schema-${i}`, 'schema-witness');
      await fc.assert(fc.asyncProperty(s.value, async expr => {
        await check(expr, `schema-${i}`, 'schema-generated');
      }), { seed: SEED + i, numRuns: SCHEMA_SAMPLES, verbose: true });
    }
    finished = true;
  });
});
