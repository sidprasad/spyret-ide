'use strict';

const fs = require('fs');
const path = require('path');

function summarize(expectedIds, rows, runErrors = []) {
  const counts = new Map();
  for (const row of rows) counts.set(row.id, (counts.get(row.id) || 0) + 1);
  const expected = new Set(expectedIds);
  const missing = expectedIds.filter(id => !counts.has(id));
  const duplicate = [...counts].filter(([, n]) => n !== 1).map(([id]) => id);
  const unexpected = [...counts.keys()].filter(id => !expected.has(id));
  const complete = expected.size > 0 && expected.size === expectedIds.length
    && !missing.length && !duplicate.length && !unexpected.length && !runErrors.length;
  const verdicts = {};
  for (const row of rows) verdicts[row.verdict] = (verdicts[row.verdict] || 0) + 1;
  const passed = rows.filter(r => r.verdict === 'pass').length;
  return { complete, fidelityHolds: complete && passed === expected.size,
    passed, total: rows.length, verdicts, missing, duplicate, unexpected, runErrors };
}

function writeReport(file, fixtures, rows, metadata, errors = []) {
  const report = { experiment: 'spyret-working-round-trip', generatedAt: new Date().toISOString(),
    ...metadata, fixtures, summary: summarize(fixtures.map(f => f.id), rows, errors), rows };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  return report;
}

module.exports = { summarize, writeReport };
