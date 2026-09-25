'use strict';

/**
 * Drives the real IDE for the reify fidelity evaluation.
 *
 * The IDE page exposes two things the harness needs: `window.__internalRepl`
 * (the REPL evaluator, installed by cpo-main.js) and `window.spytialcore`
 * (the pinned spytial-core bundle that dom-render.js diagrams with). Each case
 * uses separate producer and decoder pages:
 *
 *   1. evaluate the case once and inspect the live value -> A
 *   2. relationalize with PyretDataInstance and export JSON through Node
 *   3. reset the decoder and reify only that JSON
 *   4. load declarations, evaluate `torepr(R)` -> B, and run a Pyret check
 *
 * The decoder gets neither the expression, A, nor any producer caches.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..', '..');

const CHROME_CANDIDATES = [
  process.env.CHROME_BINARY,
  process.env.GOOGLE_CHROME_BINARY,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('No Chrome/Chromium binary found; set CHROME_BINARY to its path.');
}

function httpOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(5000, () => { req.destroy(); resolve(false); });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Use the server at BASE_URL if set, or one already listening on PORT (default
 * 4999); otherwise start `src/run.js` with a minimal local-only environment
 * (no Google credentials, no redis) and stop it again in `stop()`.
 */
async function ensureServer(options = {}) {
  if (process.env.BASE_URL) {
    return { baseUrl: process.env.BASE_URL, spawned: false, stop() {} };
  }
  const port = Number(process.env.PORT || options.port || 4999);
  const baseUrl = `http://localhost:${port}`;
  if (await httpOk(`${baseUrl}/editor`)) {
    return { baseUrl, spawned: false, stop() {} };
  }

  const env = Object.assign({}, process.env, {
    BASE_URL: baseUrl,
    ASSET_BASE_URL: baseUrl,
    PORT: String(port),
    NODE_ENV: 'development',
    SESSION_SECRET: process.env.SESSION_SECRET || 'reify-fidelity',
    PYRET: `${baseUrl}/js/cpo-main.jarr`,
    REDISCLOUD_URL: '',
    URL_FILE_MODE: 'all-remote',
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || 'unused',
    GOOGLE_APP_ID: process.env.GOOGLE_APP_ID || 'unused',
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || 'unused',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || 'unused',
  });
  const child = spawn(process.execPath, ['src/run.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let exited = null;
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  child.on('exit', (code) => { exited = code; });

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (exited !== null) {
      throw new Error(`IDE server exited with code ${exited} before it was ready:\n${output.slice(-2000)}`);
    }
    if (await httpOk(`${baseUrl}/editor`)) {
      return { baseUrl, spawned: true, stop() { child.kill(); } };
    }
    await sleep(500);
  }
  child.kill();
  throw new Error(`IDE server did not answer on ${baseUrl}/editor within 90s:\n${output.slice(-2000)}`);
}

/** Open the editor and wait until Pyret, the REPL hook and spytial-core are ready. */
async function openIde(baseUrl, pageCount = 2, options = {}) {
  // Integration-only override: replay locally built core assets at the editor's
  // existing URLs. Production pins and the Pyret runtime are unchanged. Fail
  // before launch if any asset is missing; never mix local and CDN core copies.
  const localCore = process.env.SPYTIAL_CORE_DIST ? new Map([
    'browser/spytial-core-complete.global.js',
    'components/react-component-integration.global.js',
    'components/react-component-integration.css',
  ].map(relative => [relative, fs.readFileSync(path.resolve(process.env.SPYTIAL_CORE_DIST, relative))])) : null;
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: process.env.SHOW_BROWSER ? false : 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  try {
    const pages = await Promise.all(Array.from({ length: pageCount }, () => browser.newPage()));
    // Loading two 40 MB Pyret runtimes concurrently creates substantial
    // compilation/memory pressure. Initialize the pages sequentially.
    for (const page of pages) {
      if (options.configurePage) { await options.configurePage(page); }
      if (localCore) {
        await page.evaluateOnNewDocument(() => { window.__reifyFidelityLocalCore = true; });
        await page.setRequestInterception(true);
        page.on('request', request => {
          const match = /^https:\/\/cdn\.jsdelivr\.net\/npm\/spytial-core@[^/]+\/dist\/([^?]+)(?:\?.*)?$/.exec(request.url());
          if (match && localCore.has(match[1])) {
            return request.respond({ status: 200, headers: { 'access-control-allow-origin': '*' },
              contentType: match[1].endsWith('.css') ? 'text/css' : 'application/javascript', body: localCore.get(match[1]) });
          }
          return request.continue();
        });
      }
      page.setDefaultTimeout(180000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('requestfailed', (r) => errors.push(`${r.url()}: ${r.failure().errorText}`));
      try {
        await page.goto(`${baseUrl}/editor`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => {
          const loader = document.getElementById('loader');
          return loader && getComputedStyle(loader).display === 'none'
            && window.__internalRepl
            && window.spytialcore && window.spytialcore.PyretDataInstance;
        }, { timeout: options.timeout || 180000, polling: 100 });
      } catch (e) {
        throw new Error(`IDE readiness failed: ${e.message}\n${errors.slice(-10).join('\n')}`);
      }
    }
    return { browser, page: pages[0], decoder: pages[1] };
  } catch (e) {
    await browser.close();
    throw e;
  }
}

/**
 * Installed into the page once. Everything here runs in the browser against
 * the live runtime, so it must stay plain ES2017 and self-contained.
 */
function pageRuntime() {
  const repl = window.__internalRepl;
  const rt0 = repl.runtime;
  const PDI = window.spytialcore.PyretDataInstance;

  function safeRepr(rt, v) {
    try { return rt.toReprJS(v, rt.ReprMethods._torepr); }
    catch (e) { return (v && v.$name) || String(v); }
  }
  function failureMessage(rt, res) {
    let e = res && res.exn;
    if (e && e.exn !== undefined) e = e.exn;
    if (e instanceof Error) return e.name + ': ' + e.message + '\n' + String(e.stack).slice(0, 1000);
    return 'runtime error: ' + String(safeRepr(rt, e)).slice(0, 300);
  }
  // A REPL result is { result: Either, stats }. right(opaque) wraps the
  // realm's run result {runtime, result: SuccessResult|FailureResult, ...};
  // left(list) carries compile errors.
  function unwrap(r) {
    if (!r || !r.result || !r.result.dict) return { ok: false, error: 'the REPL returned no result' };
    const v = r.result.dict.v;
    const isRight = Object.keys(r.result.brands).some((b) => b.indexOf('$brandright') === 0);
    if (isRight) {
      const val = v.val;
      const rt = val.runtime;
      const res = val.result;
      if (!rt.isSuccessResult(res)) return { ok: false, error: failureMessage(rt, res) };
      return { ok: true, rt, answer: rt.getField(res.result, 'answer'), module: res.result };
    }
    if (v && v.val) return { ok: false, error: failureMessage(v.val.runtime, v.val.result) };
    try {
      const messages = [];
      rt0.ffi.toArray(v).forEach((err) => {
        rt0.ffi.toArray(rt0.getField(err, 'problems')).forEach((p) => messages.push(safeRepr(rt0, p)));
      });
      return { ok: false, error: 'compile error: ' + messages.join('; ').slice(0, 300) };
    } catch (e) {
      return { ok: false, error: 'unrecognized failure: ' + String(e).slice(0, 200) };
    }
  }

  let counter = 0;
  // Audit witnesses only. These identities are never part of the datum sent to
  // the consumer, and never influence capture or reconstruction.
  const observedConstructors = new WeakMap();
  let nextConstructor = 0;
  async function run(code) {
    counter += 1;
    return unwrap(await repl.run(code, 'interactions://reify-fidelity-' + counter));
  }

  function datumOf(di) {
    return JSON.parse(JSON.stringify({
      atoms: di.getAtoms(), relations: di.getRelations(), types: di.getTypes(),
    }));
  }

  window.__reifyFidelity = {
    async init(prelude) {
      const u = unwrap(await repl.restartInteractions(prelude, { typeCheck: false, checkAll: false }));
      return u.ok ? { ok: true } : { ok: false, error: u.error };
    },
    coreVersion() {
      const version = window.spytialcore.version;
      if (typeof version !== 'string' || version === 'unknown') throw new Error('Core must expose its build version');
      if (window.__reifyFidelityLocalCore) return version;
      const assets = Array.from(document.querySelectorAll('script[src], link[rel="stylesheet"][href]'))
        .map(s => s.src || s.href).filter(url => /spytial-core@/.test(url));
      const required = ['browser/spytial-core-complete.global.js',
        'components/react-component-integration.global.js', 'components/react-component-integration.css'];
      if (assets.length !== required.length || !required.every(file =>
        assets.some(url => url.endsWith('/spytial-core@' + version + '/dist/' + file)))) {
        throw new Error('All three editor CDN pins must agree with the loaded core version');
      }
      return version;
    },
    // Audit-only path: evaluation obtains the fixture, then capture receives
    // only the live value. No evaluator, printer, skeleton, or DOM is supplied.
    // Keep this separate from exportWorkingCase, which measures torepr fidelity.
    async captureWorkingCase(expr) {
      const a = await run(expr);
      if (!a.ok) return { verdict: 'value-error', error: a.error };
      try {
        PDI.clearGlobalConstructorCache();
        const instance = new PDI(a.answer);
        const datum = datumOf(instance);
        // A measured legacy convention, NOT a proposed public root API.
        const rootId = instance.getAtoms()[0].id;
        const ctor = a.answer && a.answer.$constructor;
        let inputObservation;
        if (ctor && (typeof ctor === 'object' || typeof ctor === 'function')) {
          if (!observedConstructors.has(ctor)) observedConstructors.set(ctor, ++nextConstructor);
          inputObservation = { constructorIdentity: observedConstructors.get(ctor),
            name: a.answer.$name, arity: a.answer.$arity, brands: Object.keys(a.answer.brands || {}) };
        }
        return { verdict: 'captured', datum, rootId, inputObservation };
      } catch (e) {
        return { verdict: 'relationalize-error', error: String(e) };
      } finally {
        PDI.clearGlobalConstructorCache();
      }
    },
    async capturePortableCase(expr) {
      const a = await run(expr);
      if (!a.ok) return { verdict: 'value-error', error: a.error };
      try {
        const api = window.SpytialPyretCapture;
        const snapshot = api.capturePyret([{ name: 'value', value: a.answer, observation: { expression: expr } }],
          api.createPyretRuntimeAdapter(a.rt));
        return { verdict: 'captured', snapshot };
      } catch (error) {
        return { verdict: 'capture-error', error: String(error), root: error.root, path: error.path, reason: error.reason };
      }
    },
    async exportWorkingCase(expr) {
      const a = await run(expr);
      if (!a.ok) return { verdict: 'value-error', error: a.error };
      const row = {};
      try {
        row.A = a.rt.toReprJS(a.answer, a.rt.ReprMethods._torepr);
        if (typeof row.A !== 'string') throw new Error('Reference printer did not return a string');
      } catch (e) {
        return { verdict: 'reference-error', error: String(e) };
      }
      try {
        PDI.clearGlobalConstructorCache();
        // Exactly the constructor invocation in trove/dom-render.js. No
        // primitive-root adapter, synthetic wrapper or replacement encoding.
        const instance = new PDI(a.answer, {}, window.__internalRepl);
        row.datum = datumOf(instance);
        // The relationalizer visits the input before its children. Select that
        // atom at export time; root selection is not part of IDataInstance.
        row.rootId = instance.getAtoms()[0].id;
        return Object.assign(row, { verdict: 'exported' });
      } catch (e) {
        return Object.assign(row, { verdict: 'relationalize-error', error: String(e) });
      } finally {
        PDI.clearGlobalConstructorCache();
      }
    },
    reifyWorkingDatum(datum, rootId) {
      try {
        PDI.clearGlobalConstructorCache();
        const fresh = new window.spytialcore.JSONDataInstance(datum);
        if (fresh.getErrors && fresh.getErrors().length) throw new Error(fresh.getErrors().join('; '));
        const R = PDI.prototype.reify.call(fresh, rootId);
        if (typeof R !== 'string') throw new Error('Reifier did not return an expression string');
        return { verdict: 'reified', R, received: datumOf(fresh) };
      } catch (e) {
        return { verdict: 'reify-error', error: String(e) };
      } finally {
        PDI.clearGlobalConstructorCache();
      }
    },
    async inspectExpression(expr) {
      const b = await run('torepr(' + expr + ')');
      if (!b.ok) return { verdict: 'reify-eval-error', error: b.error };
      if (typeof b.answer !== 'string') return { verdict: 'harness-error', error: 'torepr returned a non-string' };
      return { verdict: 'inspected', B: b.answer };
    },
    async renderExpression(expr) {
      const r = await run('DR.genlayout(' + expr + ', "")');
      if (!r.ok) return { verdict: 'render-eval-error', error: r.error };
      const container = r.answer;
      if (!container || !container.querySelector) return { verdict: 'render-error', error: 'No diagram container' };
      document.body.appendChild(container);
      try {
        const error = container.querySelector('[id^="error-message-container-"]');
        if (error && error.textContent) return { verdict: 'render-error', error: error.textContent };
        const graph = container.querySelector('webcola-cnd-graph');
        const deadline = Date.now() + 10000;
        let nodes = 0;
        while (graph && Date.now() < deadline) {
          nodes = graph.shadowRoot ? graph.shadowRoot.querySelectorAll('g.node').length : 0;
          if (nodes) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        const source = container.querySelector('pre');
        return { verdict: nodes && source ? 'rendered' : 'render-error', nodes,
          R: source && source.textContent, snapshot: container.spytialCapture };
      } finally { container.remove(); }
    },
    async checkStrings(expected, actual) {
      // A and B reach this checker only AFTER datum-only reification and
      // evaluation. This is input escaping, not a replacement Pyret printer.
      const literal = s => '"' + s.split('').map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('') + '"';
      const code = 'check "Spytial inspection fidelity":\n  ' + literal(actual)
        + ' is ' + literal(expected) + '\nend\nnothing';
      const u = unwrap(await repl.restartInteractions(code, { typeCheck: false, checkAll: true }));
      if (!u.ok) return { verdict: 'check-error', error: u.error };
      try {
        const blocks = u.rt.ffi.toArray(u.rt.getField(u.module, 'checks'));
        const results = [];
        let errors = 0;
        for (const block of blocks) {
          if (u.rt.getField(block, 'maybe-err').$name !== 'none') errors++;
          for (const test of u.rt.ffi.toArray(u.rt.getField(block, 'test-results'))) results.push(test.$name);
        }
        const check = { blocks: blocks.length, results, errors };
        if (blocks.length !== 1 || errors || results.length !== 1
            || !['success', 'failure-not-equal'].includes(results[0])) {
          return { verdict: 'check-error', error: 'Incomplete or unexpected Pyret check result', check };
        }
        return { verdict: results[0] === 'success' ? 'pass' : 'mismatch', check };
      } catch (e) {
        return { verdict: 'check-error', error: String(e) };
      }
    },
  };
  return true;
}

module.exports = { ensureServer, openIde, pageRuntime, findChrome };
