#!/usr/bin/env node
'use strict';

/**
 * Runs the reify fidelity evaluation outside mocha and writes the JSON report
 * that the reify-eval Pyret notebook reads.
 *
 *   node test/reify-fidelity/cli.js [--out FILE] [--fuzz N] [--seed S] [--quiet]
 *
 * Exit code 1 if the documented boundary does not hold. Generated values are
 * sampled (no shrinking) so that the report is a fixed, reproducible table;
 * use the mocha suite to shrink a failing case.
 */

const path = require('path');
const fc = require('fast-check');
const { PRELUDE, CONSTRUCTOR_FIELDS, ROWS, arbitraries } = require('./corpus');
const { ensureServer, openIde, installRunner, runCase } = require('./harness');
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

  const server = await ensureServer();
  let ide;
  const rows = [];
  try {
    ide = await openIde(server.baseUrl);
    const coreVersion = await installRunner(ide, PRELUDE, CONSTRUCTOR_FIELDS);
    for (const row of ROWS) {
      if (row.expect === 'out-of-scope') continue;
      const r = Object.assign(
        { source: 'corpus', category: row.category, name: row.name, expect: row.expect, failure: row.failure, note: row.note },
        await runCase(ide, row.expr, row.options),
      );
      rows.push(r);
      if (!quiet) console.log(`${r.verdict.padEnd(18)} ${row.category}/${row.name} [${row.expect}] ${r.ms}ms`);
    }
    const { value } = arbitraries(fc);
    for (const expr of fc.sample(value, { numRuns: fuzz, seed })) {
      const r = Object.assign({ source: 'generated', category: 'value' }, await runCase(ide, expr));
      rows.push(r);
      if (!quiet && r.verdict !== 'pass') console.log(`${r.verdict.padEnd(18)} generated: ${expr}`);
    }
    const meta = {
      baseUrl: server.baseUrl, coreVersion, seed, numRuns: fuzz,
      expectedCases: ROWS.filter((r) => r.expect !== 'out-of-scope').map((r) => `${r.category}/${r.name}`),
      decoderContext: { prelude: PRELUDE, constructorFields: CONSTRUCTOR_FIELDS },
    };
    const report = writeReport(out, rows, meta);
    console.log('\n' + format(report.summary, meta) + `\n  report: ${out}`);
    process.exitCode = report.summary.boundaryHolds ? 0 : 1;
  } finally {
    try { if (ide) await ide.browser.close(); }
    finally { server.stop(); }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
