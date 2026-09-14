'use strict';

/**
 * Tier B reify fidelity -- the Pyret leg of the cross-language evaluation.
 *
 *   value -> torepr -> string                                  (A)
 *   value -> PyretDataInstance -> JSON -> isolated decoder -> string (B)
 *
 * Every assertion requires the desired behavior: A == B. Known gaps are
 * pending tests, not passing assertions that failures should stay failures.
 * Set REIFY_INCLUDE_PENDING=1 to run those tests while implementing support.
 *
 * Run with `npm run test:reify-fidelity`. Needs Chrome and network access to
 * the spytial-core CDN; starts the IDE server itself unless BASE_URL is set.
 *   REIFY_FUZZ_RUNS   generated values to try (default 100)
 *   REIFY_SEED        fast-check seed, for reproducing a failure
 *   REIFY_REPORT      where to write the JSON report
 *                     (default build/reify-fidelity-report.json)
 */

const assert = require('assert');
const path = require('path');
const fc = require('fast-check');
const { PRELUDE, ROWS, arbitraries } = require('./corpus');
const { start, runCase, replayDatum, explain } = require('../pyret-round-trip/harness');
const { format, writeReport } = require('./report');

const REPORT = process.env.REIFY_REPORT || path.resolve(__dirname, '..', '..', 'build', 'reify-fidelity-report.json');
const NUM_RUNS = Number(process.env.REIFY_FUZZ_RUNS || 100);
const SEED = Number(process.env.REIFY_SEED || 1);
const INCLUDE_PENDING = process.env.REIFY_INCLUDE_PENDING === '1';
if (!Number.isInteger(NUM_RUNS) || NUM_RUNS < 1 || !Number.isInteger(SEED)) {
  throw new Error('REIFY_FUZZ_RUNS must be positive and REIFY_SEED must be an integer');
}

describe('Pyret inspection fidelity: working datum-only round trips', function () {
  this.timeout(30 * 60 * 1000);

  const rows = [], errors = [];
  let session;

  const fixture = (expr, id) => ({ id, expr, prelude: PRELUDE });

  before(async function () {
    try {
      session = await start();
      assert.strictEqual(session.metadata.coreVersion, '6.0.0', 'Re-measure after a core upgrade');
    } catch (e) { errors.push(String(e)); throw e; }
  });

  afterEach(function () {
    if (this.currentTest.state === 'failed') errors.push(this.currentTest.title);
  });

  after(async function () {
    try {
      const meta = {
        ...session && session.metadata, seed: SEED, numRuns: NUM_RUNS, runErrors: errors,
        expectedCases: ROWS.filter((r) => r.expect !== 'out-of-scope').map((r) => `${r.category}/${r.name}`),
        pendingCases: INCLUDE_PENDING ? [] : ROWS.filter(r => r.expect === 'pending').map(r => `${r.category}/${r.name}`),
        desiredCases: ROWS.filter(r => r.expect !== 'out-of-scope'),
        evaluationContext: { prelude: PRELUDE, loadedAfterReification: true },
      };
      const report = writeReport(REPORT, rows, meta);
      // eslint-disable-next-line no-console
      console.log('\n' + format(report.summary, meta) + `\n  report: ${REPORT}\n`);
      assert.ok(report.summary.requiredChecksHold, format(report.summary, meta));
    } finally {
      if (session) await session.close();
    }
  });

  describe('systematic corpus: representative Pyret value forms', function () {
    for (const row of ROWS) {
      const title = `${row.category}: ${row.name} [${row.expect === 'pending' ? 'TODO: ' : ''}exact round trip]`;
      if (row.expect === 'out-of-scope') {
        it.skip(title);
        continue;
      }
      const check = row.expect === 'pending' && !INCLUDE_PENDING ? it.skip : it;
      check(title, async function () {
        const r = Object.assign(
          { source: 'corpus', category: row.category, name: row.name, expect: row.expect,
            desiredVerdict: row.desiredVerdict, note: row.note },
          await runCase(session, fixture(row.expr, `${row.category}/${row.name}`)),
        );
        rows.push(r);
        assert.strictEqual(r.verdict, 'pass', explain(r));
        assert.strictEqual(r.B, r.A);
        assert.deepStrictEqual(r.check, { blocks: 1, results: ['success'], errors: 0 });
      });
    }
  });

  describe('generated values over the supported forms', function () {
    it(`${NUM_RUNS} fast-check values round-trip${SEED !== undefined ? ` (seed ${SEED})` : ''}`, async function () {
      const { value } = arbitraries(fc);
      await fc.assert(
        fc.asyncProperty(value, async (expr) => {
          const r = Object.assign({ source: 'generated', category: 'value' }, await runCase(session, fixture(expr)));
          rows.push(r);
          if (r.verdict !== 'pass') throw new Error(explain(r));
        }),
        { numRuns: NUM_RUNS, seed: SEED, verbose: true },
      );
    });
  });

  describe('datum isolation and desired information preservation', function () {
    it('replays an earlier datum after a same-named constructor changes field order', async function () {
      const first = { id: 'first-schema', prelude: 'data First: replay-pair(zebra, alpha) end', expr: 'replay-pair(9, 2)' };
      const second = { id: 'second-schema', prelude: 'data Second: replay-pair(alpha, zebra) end', expr: 'replay-pair(4, 7)' };
      const a = await runCase(session, first);
      const b = await runCase(session, second);
      assert.strictEqual(a.verdict, 'pass', explain(a));
      assert.strictEqual(b.verdict, 'pass', explain(b));
      const payload = JSON.parse(JSON.stringify(a.datum));
      payload.relations.reverse();
      const replay = await replayDatum(session, payload, first.prelude);
      assert.strictEqual(replay.verdict, 'inspected', explain(replay));
      assert.strictEqual(replay.R, 'replay-pair(9, 2)');
      assert.strictEqual(replay.B, a.A);
    });

    it('decodes JSON independently of import caches and relation enumeration', async function () {
      const r = await runCase(session, fixture('node(1, leaf, leaf)'));
      assert.strictEqual(r.verdict, 'pass', explain(r));
      const payload = JSON.parse(JSON.stringify(r.datum));
      payload.relations.reverse();
      await session.ide.decoder.evaluate(() => {
        const PDI = window.spytialcore.PyretDataInstance;
        new PDI({ $name: 'node', dict: { l: 0, r: 0, v: 0 } });
      });
      const again = await replayDatum(session, payload, PRELUDE);
      assert.strictEqual(again.verdict, 'inspected', explain(again));
      assert.strictEqual(again.B, r.A);
      assert.strictEqual(again.R, 'node(1, leaf, leaf)');
    });

    for (const [left, right] of [['nothing', '{}'], ['box([raw-array: 1])', 'box([raw-array: 1, 1])']]) {
      const check = INCLUDE_PENDING ? it : it.skip;
      check(`TODO: preserves the distinction between ${left} and ${right}`, async function () {
        const a = await runCase(session, fixture(left));
        const b = await runCase(session, fixture(right));
        assert.ok(a.datum && b.datum, `${explain(a)}\n${explain(b)}`);
        assert.strictEqual(typeof a.A, 'string');
        assert.strictEqual(typeof b.A, 'string');
        assert.notStrictEqual(a.A, b.A);
        assert.notDeepStrictEqual(a.datum, b.datum, 'Different inspection strings require distinguishable data');
        assert.strictEqual(a.verdict, 'pass', explain(a));
        assert.strictEqual(b.verdict, 'pass', explain(b));
      });
    }
  });
});
