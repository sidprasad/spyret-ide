'use strict';

/**
 * Aggregates case rows into the fidelity report: per-category pass rates for
 * the systematic corpus and the generated values, plus every boundary
 * violation (a supported row that fails, an unsupported row that passes, or a
 * generated value that fails).
 */

const fs = require('fs');
const path = require('path');

function isViolation(r) {
  if (r.source === 'generated') return r.verdict !== 'pass';
  if (r.expect === 'supported') return r.verdict !== 'pass';
  if (r.expect === 'unsupported') return r.verdict === 'pass';
  return false;
}

function summarize(rows) {
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
  const rate = (xs) => (xs.length ? xs.filter((r) => r.verdict === 'pass').length / xs.length : 1);

  return {
    counts: { rows: rows.length, corpus: corpus.length, generated: generated.length, verdicts },
    /** headline: how much of the systematic corpus round-trips today */
    corpusPassRate: rate(corpus),
    supportedPassRate: rate(corpus.filter((r) => r.expect === 'supported')),
    generatedPassRate: rate(generated),
    scores,
    violations: rows.filter(isViolation),
    boundaryHolds: rows.every((r) => !isViolation(r)),
  };
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function format(summary, meta = {}) {
  const lines = [];
  lines.push('=== Reify fidelity report (Tier B: torepr vs torepr(eval(reify(datum)))) ===');
  if (meta.baseUrl) lines.push(`  IDE: ${meta.baseUrl}   spytial-core: ${meta.coreVersion || '?'}`);
  for (const s of summary.scores) {
    lines.push(`  ${s.group.padEnd(20)} ${s.category.padEnd(14)} ${String(s.pass).padStart(3)}/${String(s.total).padEnd(3)} ${pct(s.rate)}`);
  }
  lines.push(`  corpus rows passing:       ${pct(summary.corpusPassRate)}  (${summary.counts.corpus} rows)`);
  lines.push(`  supported rows passing:    ${pct(summary.supportedPassRate)}`);
  lines.push(`  generated values passing:  ${pct(summary.generatedPassRate)}  (${summary.counts.generated} values)`);
  lines.push(`  verdicts: ${JSON.stringify(summary.counts.verdicts)}`);
  if (summary.violations.length) {
    lines.push(`  boundary violations: ${summary.violations.length}`);
    for (const v of summary.violations.slice(0, 20)) {
      const tag = v.source === 'generated' ? 'generated' : `${v.category}/${v.name} [${v.expect}]`;
      lines.push(`    ${tag}: ${v.verdict}${v.error ? ' -- ' + v.error : ''}`);
      lines.push(`      expr: ${v.expr.replace(/\n/g, ' ')}`);
      if (v.A !== undefined) lines.push(`      A: ${v.A}`);
      if (v.R !== undefined) lines.push(`      R: ${v.R}`);
      if (v.B !== undefined) lines.push(`      B: ${v.B}`);
    }
  } else {
    lines.push('  boundary violations: none');
  }
  return lines.join('\n');
}

/** Keep the datum only where it helps explain a failure, to keep the JSON small. */
function compactRows(rows) {
  return rows.map((r) => (r.verdict === 'pass' ? Object.assign({}, r, { datum: undefined }) : r));
}

function writeReport(file, rows, meta = {}) {
  const report = Object.assign(
    { generatedAt: new Date().toISOString() },
    meta,
    { summary: summarize(rows), rows: compactRows(rows) },
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  return report;
}

module.exports = { summarize, format, writeReport, isViolation };
