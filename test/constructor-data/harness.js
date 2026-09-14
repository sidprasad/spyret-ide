'use strict';

const { ensureServer, openIde, pageRuntime } = require('../reify-fidelity/harness');

async function start() {
  const server = await ensureServer();
  let ide;
  try {
    ide = await openIde(server.baseUrl);
    for (const page of [ide.page, ide.decoder]) await page.evaluate(pageRuntime);
    const versions = await Promise.all([ide.page, ide.decoder].map(p =>
      p.evaluate(() => window.__reifyFidelity.coreVersion())));
    if (versions[0] !== versions[1]) throw new Error('Producer/decoder core versions differ');
    const metadata = { baseUrl: server.baseUrl, coreVersion: versions[0],
      browserVersion: await ide.browser.version(), nodeVersion: process.version };
    if (process.env.SPYTIAL_CORE_DIST) metadata.coreDistOverride = require('path').resolve(process.env.SPYTIAL_CORE_DIST);
    // Record the exact deployed artifacts, not just this checkout's version.
    // The runtime can come from a different build or a supplied BASE_URL.
    metadata.artifacts = await ide.page.evaluate(async () => {
      const urls = [...new Set(performance.getEntriesByType('resource').map(r => r.name))]
        .filter(u => /cpo-main\.jarr|spytial-core@.*\.js(?:\?|$)/.test(u));
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
        || !metadata.artifacts.some(a => /spytial-core@/.test(a.url))) {
      throw new Error('Could not identify the loaded Pyret/core artifacts');
    }
    return { ide, metadata, async close() {
      try { await ide.browser.close(); } finally { server.stop(); }
    } };
  } catch (e) {
    try { if (ide) await ide.browser.close(); } finally { server.stop(); }
    throw e;
  }
}

async function init(page, prelude) {
  const r = await page.evaluate(p => window.__reifyFidelity.init(p, {}), prelude);
  if (!r.ok) throw new Error(r.error);
}

// This function records EVERY failure, including initialization and transport
// errors, instead of throwing before a row can be recorded by the caller.
async function runCase(session, fixture) {
  const { page, decoder } = session.ide;
  const row = { id: fixture.id, expr: fixture.expr, prelude: fixture.prelude };
  let stage = 'producer-init';
  try {
    await init(page, fixture.prelude);
    stage = 'producer-export';
    Object.assign(row, await page.evaluate(e => window.__reifyFidelity.exportWorkingCase(e), fixture.expr));
    if (row.verdict !== 'exported') return row;

    // Clear the decoder's previous fixture BEFORE reification. No declarations,
    // original expression or A are passed to the reifier, just serialized JSON.
    stage = 'decoder-reset';
    await init(decoder, 'nothing');
    stage = 'reify';
    Object.assign(row, await decoder.evaluate(json =>
      window.__reifyFidelity.reifyWorkingDatum(JSON.parse(json)), JSON.stringify(row.datum)));
    if (row.verdict !== 'reified') return row;

    // Declarations are available only for evaluating the completed expression.
    stage = 'decoder-init';
    await init(decoder, fixture.prelude);
    stage = 'decoder-eval';
    Object.assign(row, await decoder.evaluate(r => window.__reifyFidelity.inspectExpression(r), row.R));
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
  }
  return row;
}

module.exports = { start, runCase };
