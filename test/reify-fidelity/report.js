'use strict';

/**
 * Aggregates case rows into the fidelity report: per-category pass rates for
 * the systematic corpus and generated values. Every measured failure is a
 * gap against the desired behavior, even if it is a known pending feature.
 */

const fs = require('fs');
const path = require('path');

function isViolation(r) {
  return (r.source === 'generated' || r.expect !== 'out-of-scope') && r.verdict !== 'pass';
}

function summarize(rows, meta = {}, assertions = []) {
  const byKey = new Map();
  const bump = (key, ok) => {
    const e = byKey.get(key) || { pass: 0, total: 0 };
    e.total += 1;
    if (ok) e.pass += 1;
    byKey.set(key, e);
  };
  const verdicts = {};
  for (const r of rows) {
    verdicts[r.verdict] = (verdicts[r.verdict] || 0) + 1;
    const group = r.source === 'generated' ? 'generated' : `corpus:${r.expect}`;
    bump(`${group}::${r.category || 'value'}`, r.verdict === 'pass');
  }
  const scores = Array.from(byKey.entries())
    .map(([key, e]) => {
      const [group, category] = key.split('::');
      return { group, category, pass: e.pass, total: e.total, rate: e.total ? e.pass / e.total : 1 };
    })
    .sort((a, b) => a.group.localeCompare(b.group) || a.category.localeCompare(b.category));

  const corpus = rows.filter((r) => r.source !== 'generated' && r.expect !== 'out-of-scope');
  const generated = rows.filter((r) => r.source === 'generated');
  const rate = (xs) => (xs.length ? xs.filter((r) => r.verdict === 'pass').length / xs.length : null);
  const actualCases = new Set(corpus.map((r) => `${r.category}/${r.name}`));
  const expectedCases = meta.expectedCases || [...actualCases];
  const expected = new Set(expectedCases);
  const pending = new Set(meta.pendingCases || []);
  const missingCases = expectedCases.filter(key => !actualCases.has(key));
  const pendingCases = missingCases.filter(key => pending.has(key));
  const requiredMissingCases = missingCases.filter(key => !pending.has(key));
  const unexpectedCases = [...actualCases].filter(key => !expected.has(key));
  const validManifest = expected.size === expectedCases.length && [...pending].every(key => expected.has(key));
  const runErrors = meta.runErrors || [];
  const validRun = !runErrors.length && rows.length > 0 && validManifest && actualCases.size === corpus.length
    && !unexpectedCases.length && (meta.numRuns === undefined || generated.length >= meta.numRuns);

  const assertionIds = assertions.map(r => r.id);
  const expectedAssertions = meta.expectedAssertions || [];
  const missingAssertions = expectedAssertions.filter(id => !assertionIds.includes(id));
  const unexpectedAssertions = assertionIds.filter(id => !expectedAssertions.includes(id));
  const pendingAssertionIds = new Set(meta.pendingAssertions || []);
  const pendingAssertions = missingAssertions.filter(id => pendingAssertionIds.has(id));
  const requiredMissingAssertions = missingAssertions.filter(id => !pendingAssertionIds.has(id));
  const validAssertions = new Set(expectedAssertions).size === expectedAssertions.length
    && new Set(assertionIds).size === assertionIds.length && !unexpectedAssertions.length
    && [...pendingAssertionIds].every(id => expectedAssertions.includes(id));
  const assertionsComplete = validAssertions && !missingAssertions.length;
  const requiredAssertionsComplete = validAssertions && !requiredMissingAssertions.length;
  const assertionsPass = assertions.every(r => r.verdict === 'pass');
  const assertionsHold = assertionsComplete && assertionsPass;
  const requiredAssertionsHold = requiredAssertionsComplete && assertionsPass;
  const complete = validRun && missingCases.length === 0 && assertionsComplete;
  const requiredComplete = validRun && requiredMissingCases.length === 0 && requiredAssertionsComplete;
  const assertionCategories = [...new Set(assertions.map(r => r.category))];
  const assertionScores = assertionCategories.map(category => ({ category,
    pass: assertions.filter(r => r.category === category && r.verdict === 'pass').length,
    total: assertions.filter(r => r.category === category).length }));

  return {
    assertionsHold, requiredAssertionsHold, assertionScores, missingAssertions, unexpectedAssertions,
    pendingAssertions, requiredMissingAssertions,
    assertionViolations: assertions.filter(r => r.verdict !== 'pass'),
    counts: { rows: rows.length, corpus: corpus.length, generated: generated.length, assertions: assertions.length, pending: pendingCases.length, verdicts },
    /** headline: how much of the systematic corpus round-trips today */
    corpusPassRate: rate(corpus),
    supportedPassRate: rate(corpus.filter((r) => r.expect === 'supported')),
    generatedPassRate: rate(generated),
    scores,
    violations: rows.filter(isViolation),
    complete,
    missingCases,
    pendingCases,
    requiredMissingCases,
    unexpectedCases,
    runErrors,
    requiredChecksHold: requiredComplete && requiredAssertionsHold && rows.every(r => !isViolation(r)),
    fidelityHolds: complete && assertionsHold && rows.every(r => !isViolation(r)),
  };
}

function pct(x) {
  return x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`;
}

function format(summary, meta = {}) {
  const lines = [];
  lines.push('=== Pyret fidelity: working datum-only round trips ===');
  if (meta.baseUrl) lines.push(`  IDE: ${meta.baseUrl}   spytial-core: ${meta.coreVersion || '?'}`);
  for (const s of summary.scores) {
    lines.push(`  ${s.group.padEnd(20)} ${s.category.padEnd(14)} ${String(s.pass).padStart(3)}/${String(s.total).padEnd(3)} ${pct(s.rate)}`);
  }
  lines.push(`  corpus rows passing:       ${pct(summary.corpusPassRate)}  (${summary.counts.corpus} rows)`);
  lines.push(`  supported rows passing:    ${pct(summary.supportedPassRate)}`);
  lines.push(`  generated values passing:  ${pct(summary.generatedPassRate)}  (${summary.counts.generated} values)`);
  for (const s of summary.assertionScores) lines.push(`  observation:${s.category} ${s.pass}/${s.total}`);
  for (const id of summary.requiredMissingAssertions) lines.push(`  MISSING OBSERVATION: ${id}`);
  for (const id of summary.pendingAssertions) lines.push(`  PENDING OBSERVATION: ${id}`);
  for (const id of summary.unexpectedAssertions) lines.push(`  UNEXPECTED OBSERVATION: ${id}`);
  for (const r of summary.assertionViolations) lines.push(`  OBSERVATION FAILURE: ${r.id}: ${r.verdict} ${r.error || ''}`);
  lines.push(`  content/behavior checks satisfied: ${summary.assertionsHold}`);
  lines.push(`  verdicts: ${JSON.stringify(summary.counts.verdicts)}`);
  for (const error of summary.runErrors) lines.push(`  RUN ERROR: ${error}`);
  if (summary.pendingCases.length) lines.push(`  PENDING desired behaviors (${summary.pendingCases.length}): ${summary.pendingCases.join(', ')}`);
  lines.push(`  full desired corpus satisfied: ${summary.fidelityHolds}`);
  if (!summary.complete) lines.push(`  INCOMPLETE MEASUREMENT; unmeasured cases: ${[...summary.missingCases, ...summary.missingAssertions].join(', ') || '(check manifest/generated count)'}`);
  if (summary.violations.length) {
    lines.push(`  gaps against desired behavior: ${summary.violations.length}`);
    for (const v of summary.violations.slice(0, 20)) {
      const tag = v.source === 'generated' ? 'generated' : `${v.category}/${v.name} [${v.expect}]`;
      lines.push(`    ${tag}: ${v.verdict}${v.error ? ' -- ' + v.error : ''}`);
      lines.push(`      expr: ${v.expr.replace(/\n/g, ' ')}`);
      if (v.A !== undefined) lines.push(`      A: ${v.A}`);
      if (v.R !== undefined) lines.push(`      R: ${v.R}`);
      if (v.B !== undefined) lines.push(`      B: ${v.B}`);
    }
  } else {
    lines.push('  measured inspection gaps: none (pending cases, if any, remain unverified)');
  }
  return lines.join('\n');
}

function writeReport(file, rows, meta = {}, assertions = []) {
  const report = Object.assign(
    { generatedAt: new Date().toISOString() },
    meta,
    { summary: summarize(rows, meta, assertions), rows, assertions },
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  return report;
}

module.exports = { summarize, format, writeReport, isViolation };
