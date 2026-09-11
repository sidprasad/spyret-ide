'use strict';

/**
 * Tier B reify fidelity -- the Pyret leg of the cross-language evaluation.
 *
 *   value -> torepr -> string                                  (A)
 *   value -> PyretDataInstance -> reify() -> eval -> torepr    (B)
 *
 * Passes when the systematic corpus lands exactly on its documented boundary
 * (every `supported` row has A == B, every `unsupported` row does not) and
 * every generated value over the supported forms has A == B.
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
const { ensureServer, openIde, installRunner, runCase, explain } = require('./harness');
const { summarize, format, writeReport } = require('./report');

const REPORT = process.env.REIFY_REPORT || path.resolve(__dirname, '..', '..', 'build', 'reify-fidelity-report.json');
const NUM_RUNS = Number(process.env.REIFY_FUZZ_RUNS || 100);
const SEED = process.env.REIFY_SEED !== undefined ? Number(process.env.REIFY_SEED) : undefined;

describe('Reify fidelity (Tier B): torepr(v) == torepr(eval(reify(rel(v))))', function () {
  this.timeout(30 * 60 * 1000);

  const rows = [];
  let server;
  let ide;
  let coreVersion;

  before(async function () {
    server = await ensureServer();
    ide = await openIde(server.baseUrl);
    coreVersion = await installRunner(ide.page, PRELUDE);
  });

  after(async function () {
    if (rows.length) {
      const meta = { baseUrl: server && server.baseUrl, coreVersion, seed: SEED, numRuns: NUM_RUNS };
      const report = writeReport(REPORT, rows, meta);
      // eslint-disable-next-line no-console
      console.log('\n' + format(report.summary, meta) + `\n  report: ${REPORT}\n`);
    }
    if (ide) await ide.browser.close();
    if (server) server.stop();
  });

  describe('systematic corpus: one row per Pyret value form', function () {
    for (const row of ROWS) {
      const title = `${row.category}: ${row.name} [${row.expect}]`;
      if (row.expect === 'out-of-scope') {
        it.skip(title);
        continue;
      }
      it(title, async function () {
        const r = Object.assign(
          { source: 'corpus', category: row.category, name: row.name, expect: row.expect, note: row.note },
          await runCase(ide.page, row.expr, row.options),
        );
        rows.push(r);
        if (row.expect === 'supported') {
          assert.ok(r.verdict === 'pass', `supported row does not round-trip:\n${explain(r)}`);
        } else {
          assert.ok(r.verdict !== 'pass', `unsupported row now passes; promote it to supported:\n${explain(r)}`);
        }
      });
    }
  });

  describe('generated values over the supported forms', function () {
    it(`${NUM_RUNS} fast-check values round-trip${SEED !== undefined ? ` (seed ${SEED})` : ''}`, async function () {
      const { value } = arbitraries(fc);
      await fc.assert(
        fc.asyncProperty(value, async (expr) => {
          const r = Object.assign({ source: 'generated', category: 'value' }, await runCase(ide.page, expr));
          rows.push(r);
          if (r.verdict !== 'pass') throw new Error(explain(r));
        }),
        { numRuns: NUM_RUNS, seed: SEED, verbose: true },
      );
    });
  });

  it('the documented boundary holds', function () {
    const summary = summarize(rows);
    assert.ok(summary.boundaryHolds, format(summary));
  });
});
