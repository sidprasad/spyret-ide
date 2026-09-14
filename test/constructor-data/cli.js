#!/usr/bin/env node
'use strict';

const path = require('path');
const { fixtures } = require('./corpus');
const { start, runCase } = require('../pyret-round-trip/harness');
const { writeReport } = require('./report');

async function main() {
  const seed = Number(process.env.CONSTRUCTOR_SEED || 1);
  const runs = Number(process.env.CONSTRUCTOR_RUNS || 0);
  const schemaCount = Number(process.env.CONSTRUCTOR_SCHEMAS || 0);
  const cases = fixtures(runs, seed, schemaCount);
  const file = process.env.CONSTRUCTOR_REPORT || path.resolve(__dirname, '../../build/constructor-data-report.json');
  const rows = [], errors = [];
  let session;
  try {
    session = await start();
    for (const fixture of cases) {
      const row = await runCase(session, fixture);
      rows.push(row);
      console.log(`${fixture.id}: ${row.verdict}${row.error ? ' — ' + row.error.split('\n')[0] : ''}`);
    }
  } catch (e) {
    errors.push(String(e));
  } finally {
    try { if (session) await session.close(); } catch (e) { errors.push(String(e)); }
    const report = writeReport(file, cases, rows, { ...session && session.metadata, seed, runs, schemaCount }, errors);
    console.log(JSON.stringify(report.summary, null, 2));
    console.log(`Report: ${file}`);
    process.exitCode = report.summary.fidelityHolds ? 0 : 1;
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
