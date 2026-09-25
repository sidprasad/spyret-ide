'use strict';

const { ensureServer, openIde, pageRuntime } = require('./browser');

async function start() {
  const server = await ensureServer();
  let ide;
  try {
    ide = await openIde(server.baseUrl);
    for (const page of [ide.page, ide.decoder]) await page.evaluate(pageRuntime);
    const versions = await Promise.all([ide.page, ide.decoder].map(p =>
      p.evaluate(() => window.__reifyFidelity.coreVersion())));
    if (versions[0] !== versions[1]) throw new Error('Producer/decoder core versions differ');
    const metadata = { protocol: 'spyret-datum-root-v2', baseUrl: server.baseUrl, coreVersion: versions[0],
      browserVersion: await ide.browser.version(), nodeVersion: process.version };
    if (process.env.SPYTIAL_CORE_DIST) metadata.coreDistOverride = require('path').resolve(process.env.SPYTIAL_CORE_DIST);
    // Record the exact deployed artifacts, not just this checkout's version.
    // The runtime can come from a different build or a supplied BASE_URL.
    metadata.artifacts = await ide.page.evaluate(async () => {
      const urls = [...new Set(performance.getEntriesByType('resource').map(r => r.name))]
        .filter(u => /cpo-main\.jarr|spytial-core@.*\.(?:js|css)(?:\?|$)|\/spytial-pyret-capture\.js(?:\?|$)/.test(u));
      return Promise.all(urls.map(async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Cannot fingerprint ' + url);
        const bytes = await response.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return { url, bytes: bytes.byteLength,
          sha256: Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('') };
      }));
    });
    if (!metadata.artifacts.some(a => /cpo-main\.jarr/.test(a.url))
        || metadata.artifacts.filter(a => /spytial-core@/.test(a.url)).length !== 3) {
      throw new Error('Could not identify the loaded Pyret/core artifacts');
    }
    const spyret = require('../../lib/js/spytial-pyret-capture.json');
    const capture = metadata.artifacts.find(a => /\/spytial-pyret-capture\.js(?:\?|$)/.test(a.url));
    if (!capture || capture.sha256 !== spyret.sha256) {
      throw new Error('The browser must load the locked, published Spyret package');
    }
    metadata.spyretVersion = spyret.version;
    return { ide, metadata, async close() {
      try { await ide.browser.close(); } finally { server.stop(); }
    } };
  } catch (e) {
    try { if (ide) await ide.browser.close(); } finally { server.stop(); }
    throw e;
  }
}

async function init(page, prelude) {
  const r = await page.evaluate(p => window.__reifyFidelity.init(p), prelude);
  if (!r.ok) throw new Error(r.error);
}

// The same datum-only decoding path serves ordinary cases and isolation replays.
// The prelude is evaluation context, never an argument to the reifier.
async function replayDatum(session, datum, prelude, rootId) {
  const { decoder } = session.ide;
  const row = {};
  let stage = 'decoder-reset';
  try {
    // Clear the decoder's previous fixture BEFORE reification. No declarations,
    // original expression or A reach the reifier; it receives serialized JSON
    // and the selected root ID.
    await init(decoder, 'nothing');
    stage = 'reify';
    Object.assign(row, await decoder.evaluate((json, root) =>
      window.__reifyFidelity.reifyWorkingDatum(JSON.parse(json), root), JSON.stringify(datum), rootId));
    if (row.verdict !== 'reified') return row;

    // Declarations are available only for evaluating the completed expression.
    stage = 'decoder-init';
    await init(decoder, prelude);
    stage = 'decoder-eval';
    Object.assign(row, await decoder.evaluate(r => window.__reifyFidelity.inspectExpression(r), row.R));
  } catch (e) {
    row.verdict = 'harness-error';
    row.error = String(e);
  } finally {
    row.stage = stage;
  }
  return row;
}

// Record EVERY failure, including initialization and transport errors, instead
// of throwing before the caller can record its row.
async function runCase(session, fixture) {
  const started = Date.now();
  const { page } = session.ide;
  const row = { id: fixture.id, expr: fixture.expr, prelude: fixture.prelude };
  let stage = 'producer-init';
  try {
    await init(page, fixture.prelude);
    stage = 'producer-export';
    Object.assign(row, await page.evaluate(e => window.__reifyFidelity.exportWorkingCase(e), fixture.expr));
    if (row.verdict !== 'exported') return row;

    Object.assign(row, await replayDatum(session, row.datum, fixture.prelude, row.rootId));
    stage = row.stage;
    if (row.verdict !== 'inspected') return row;

    stage = 'pyret-check';
    Object.assign(row, await page.evaluate((a, b) => window.__reifyFidelity.checkStrings(a, b), row.A, row.B));
    if (['pass', 'mismatch'].includes(row.verdict) && (row.verdict === 'pass') !== (row.A === row.B)) {
      row.verdict = 'harness-error';
      row.error = 'Pyret check disagrees with exact string equality';
    }
  } catch (e) {
    row.verdict = 'harness-error';
    row.error = String(e);
  } finally {
    row.stage = stage;
    row.ms = Date.now() - started;
  }
  return row;
}

// Stronger observations use the SAME exported datum and completed expression.
// Their source/context never reaches reification. Keep the ordinary inspection
// evidence as a nested record, so a marker match cannot count as a content test.
async function runObservation(session, fixture) {
  const started = Date.now();
  const row = await runCase(session, fixture);
  row.observation = fixture.observe;
  row.inspection = { A: row.A, B: row.B, verdict: row.verdict, check: row.check };
  if (row.verdict !== 'pass') return row;
  try {
    row.stage = 'observation-eval';
    await init(session.ide.page, fixture.prelude);
    const a = await session.ide.page.evaluate(expr => window.__reifyFidelity.inspectExpression(expr),
      `(${fixture.observe})(${fixture.expr})`);
    if (a.verdict !== 'inspected') return Object.assign(row, a);
    await init(session.ide.decoder, fixture.prelude);
    const b = await session.ide.decoder.evaluate(expr => window.__reifyFidelity.inspectExpression(expr),
      `(${fixture.observe})(${row.R})`);
    if (b.verdict !== 'inspected') return Object.assign(row, b);
    row.A = a.B;
    row.B = b.B;
    row.stage = 'observation-check';
    if (fixture.expected !== undefined) {
      row.expected = fixture.expected;
      row.oracle = await session.ide.page.evaluate((expected, actual) =>
        window.__reifyFidelity.checkStrings(expected, actual), fixture.expected, row.A);
      if (row.oracle.verdict !== 'pass') {
        row.verdict = 'observation-oracle-error';
        row.error = 'Original value did not satisfy the claimed behavior';
        return row;
      }
    }
    Object.assign(row, await session.ide.page.evaluate((a, b) =>
      window.__reifyFidelity.checkStrings(a, b), row.A, row.B));
    if (['pass', 'mismatch'].includes(row.verdict) && (row.verdict === 'pass') !== (row.A === row.B)) {
      row.verdict = 'harness-error';
      row.error = 'Pyret observation check disagrees with exact string equality';
    }
  } catch (e) {
    row.verdict = 'harness-error';
    row.error = String(e);
  } finally {
    row.ms = Date.now() - started;
  }
  return row;
}

function explain(r) {
  const lines = [`expr: ${r.expr}`];
  if (r.A !== undefined) lines.push(`A (torepr):          ${r.A}`);
  if (r.R !== undefined) lines.push(`R (reify):           ${r.R}`);
  if (r.B !== undefined) lines.push(`B (torepr of eval R): ${r.B}`);
  if (r.error) lines.push(`error: ${r.error}`);
  lines.push(`verdict: ${r.verdict} (stage: ${r.stage})`);
  return lines.join('\n');
}

module.exports = { start, runCase, runObservation, replayDatum, explain };
