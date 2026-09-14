#!/usr/bin/env node
'use strict';

/**
 * Runs the reify fidelity evaluation outside mocha and writes the JSON report
 * that the reify-eval Pyret notebook reads.
 *
 *   node test/reify-fidelity/cli.js [--out FILE] [--fuzz N] [--seed S] [--quiet]
 *
 * Runs pending cases too. Exit code 1 for ANY failure of exact fidelity.
 * Known gaps are measurements, never successful expected failures. Values are
 * sampled (no shrinking) so that the report is a fixed, reproducible table;
 * use the mocha suite to shrink a failing case.
 */

const path = require('path');
const fc = require('fast-check');
const { PRELUDE, ROWS, arbitraries } = require('./corpus');
const { start, runCase } = require('../pyret-round-trip/harness');
const { format, writeReport } = require('./report');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

async function main() {
  const out = arg('--out', process.env.REIFY_REPORT || path.resolve(__dirname, '..', '..', 'build', 'reify-fidelity-report.json'));
  const fuzz = Number(arg('--fuzz', process.env.REIFY_FUZZ_RUNS || 100));
  const seed = Number(arg('--seed', process.env.REIFY_SEED || 1));
  const quiet = process.argv.includes('--quiet');
  if (!Number.isInteger(fuzz) || fuzz < 1 || !Number.isInteger(seed)) {
    throw new Error('--fuzz must be positive and --seed must be an integer');
  }

  let session;
  const rows = [], errors = [];
  try {
    session = await start();
    for (const row of ROWS) {
      if (row.expect === 'out-of-scope') continue;
      const r = Object.assign(
        { source: 'corpus', category: row.category, name: row.name, expect: row.expect,
          desiredVerdict: row.desiredVerdict, note: row.note },
        await runCase(session, { id: `${row.category}/${row.name}`, expr: row.expr, prelude: PRELUDE }),
      );
      rows.push(r);
      if (!quiet) console.log(`${r.verdict.padEnd(18)} ${row.category}/${row.name} [${row.expect}] ${r.ms}ms`);
    }
    const { value } = arbitraries(fc);
    for (const expr of fc.sample(value, { numRuns: fuzz, seed })) {
      const r = Object.assign({ source: 'generated', category: 'value' },
        await runCase(session, { expr, prelude: PRELUDE }));
      rows.push(r);
      if (!quiet && r.verdict !== 'pass') console.log(`${r.verdict.padEnd(18)} generated: ${expr}`);
    }
  } catch (e) {
    errors.push(String(e));
  } finally {
    try { if (session) await session.close(); } catch (e) { errors.push(String(e)); }
    const meta = {
      ...session && session.metadata, seed, numRuns: fuzz, runErrors: errors,
      expectedCases: ROWS.filter((r) => r.expect !== 'out-of-scope').map((r) => `${r.category}/${r.name}`),
      desiredCases: ROWS.filter(r => r.expect !== 'out-of-scope'),
      evaluationContext: { prelude: PRELUDE, loadedAfterReification: true },
    };
    const report = writeReport(out, rows, meta);
    console.log('\n' + format(report.summary, meta) + `\n  report: ${out}`);
    process.exitCode = report.summary.fidelityHolds ? 0 : 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
