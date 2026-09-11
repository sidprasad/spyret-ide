'use strict';

/**
 * Drives the real IDE for the reify fidelity evaluation.
 *
 * The IDE page exposes two things the harness needs: `window.__internalRepl`
 * (the REPL evaluator, installed by cpo-main.js) and `window.spytialcore`
 * (the pinned spytial-core bundle that dom-render.js diagrams with). Each case
 * runs entirely inside the page:
 *
 *   1. evaluate `{v; torepr(v)}` for the case's source -> the live value and A
 *   2. relationalize the live value with PyretDataInstance -> datum, R = reify()
 *   3. evaluate `torepr(R)` -> B
 *
 * and reports A, R, B and a verdict. No DOM rendering happens, so a case costs
 * two REPL interactions and a few tens of milliseconds.
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
async function openIde(baseUrl) {
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: process.env.SHOW_BROWSER ? false : 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(180000);
  await page.goto(`${baseUrl}/editor`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const loader = document.getElementById('loader');
    return loader && getComputedStyle(loader).display === 'none'
      && window.__internalRepl
      && window.spytialcore && window.spytialcore.PyretDataInstance;
  }, { timeout: 180000 });
  return { browser, page };
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
      return { ok: true, rt, answer: rt.getField(res.result, 'answer') };
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
  async function run(code) {
    counter += 1;
    return unwrap(await repl.run(code, 'interactions://reify-fidelity-' + counter));
  }

  // Mirrors relationalize() in spytial-core tests/pyret/oracles.ts: a primitive
  // at the root gets a single atom, everything else goes through the constructor.
  function relationalize(v, options) {
    const t = typeof v;
    if (t === 'number' || t === 'string' || t === 'boolean') {
      const type = t === 'number' ? 'Number' : t === 'string' ? 'String' : 'Boolean';
      const di = new PDI(null, options);
      di.addAtom({ id: 'prim_' + type + '_' + String(v), type, label: String(v) });
      return di;
    }
    return new PDI(v, options);
  }
  function datumOf(di) {
    return {
      atoms: di.getAtoms().map((a) => ({ id: a.id, type: a.type, label: String(a.label) })),
      relations: di.getRelations().map((r) => ({ id: r.id, tuples: r.tuples.map((t) => t.atoms.slice()) })),
    };
  }

  window.__reifyFidelity = {
    async init(prelude) {
      const u = unwrap(await repl.restartInteractions(prelude, { typeCheck: false, checkAll: false }));
      return u.ok ? { ok: true } : { ok: false, error: u.error };
    },
    coreVersion() {
      const script = Array.from(document.scripts).map((s) => s.src).find((s) => /spytial-core@/.test(s));
      const m = script && /spytial-core@([^/]+)/.exec(script);
      return m ? m[1] : 'unknown';
    },
    async runCase(expr, options) {
      const t0 = performance.now();
      const row = { expr };
      const finish = (verdict, error) => {
        row.verdict = verdict;
        if (error) row.error = error;
        row.ms = Math.round(performance.now() - t0);
        return row;
      };

      const a = await run('block:\n  v = ' + expr + '\n  {v; torepr(v)}\nend');
      if (!a.ok) return finish('value-error', a.error);
      const value = a.answer.vals[0];
      row.A = a.answer.vals[1];

      try {
        PDI.clearGlobalConstructorCache();
        const di = relationalize(value, options || {});
        row.R = di.reify();
        row.datum = datumOf(di);
      } catch (e) {
        return finish('relationalize-error', String(e).slice(0, 300));
      }

      const b = await run('torepr(' + row.R + ')');
      if (!b.ok) return finish('reify-eval-error', b.error);
      row.B = b.answer;
      return finish(row.A === row.B ? 'pass' : 'mismatch');
    },
  };
  return true;
}

async function installRunner(page, prelude) {
  await page.evaluate(pageRuntime);
  const r = await page.evaluate((p) => window.__reifyFidelity.init(p), prelude);
  if (!r.ok) throw new Error(`prelude failed to run: ${r.error}`);
  return page.evaluate(() => window.__reifyFidelity.coreVersion());
}

/** Run one case; returns { expr, A, R, B, datum, verdict, error, ms }. */
function runCase(page, expr, options) {
  return page.evaluate((e, o) => window.__reifyFidelity.runCase(e, o), expr, options || {});
}

/** One-line-per-path explanation of a row, for assertion messages and reports. */
function explain(r) {
  const lines = [`expr: ${r.expr}`];
  if (r.A !== undefined) lines.push(`A (torepr):          ${r.A}`);
  if (r.R !== undefined) lines.push(`R (reify):           ${r.R}`);
  if (r.B !== undefined) lines.push(`B (torepr of eval R): ${r.B}`);
  if (r.error) lines.push(`error: ${r.error}`);
  lines.push(`verdict: ${r.verdict}`);
  return lines.join('\n');
}

module.exports = { ensureServer, openIde, installRunner, runCase, explain, findChrome };
