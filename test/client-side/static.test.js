'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const {createStaticServer} = require('../../src/scripts/serve-static');
const {openIde, pageRuntime} = require('../pyret-round-trip/browser');
const {publicConfig} = require('../../src/scripts/build-static');

describe('static client-only IDE', function() {
  this.timeout(300000);
  let server, ide, origin;
  const requests = [], errors = [];
  before(async function() {
    const directory = path.resolve(__dirname, '../../build/static');
    const {basePath} = JSON.parse(fs.readFileSync(path.join(directory, 'static-config.json'), 'utf8'));
    server = createStaticServer(directory, basePath);
    server.on('request', req => requests.push({url: req.url, method: req.method}));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = 'http://127.0.0.1:' + server.address().port + basePath;
    console.log('    Static test origin: ' + origin);
    ide = await openIde(origin, 1, {configurePage: async page => {
      // The offline tests must remain deterministic when testing an artifact
      // built with real deployment credentials (for example in Pages CI).
      // Ignore the HTML's initial client ID; the Google simulation sets it later.
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(window, 'GOOGLE_CLIENT_ID', {configurable: true, set() {
          Object.defineProperty(window, 'GOOGLE_CLIENT_ID', {configurable: true, writable: true, value: ''});
        }});
      });
      page.on('pageerror', error => console.error('    Browser error:', String(error)));
      page.on('requestfailed', request => console.error('    Request failed:', request.url(), request.failure().errorText));
      page.on('console', msg => { if (msg.type() === 'error') { console.error('    Browser console:', msg.text().slice(0, 300)); } });
    }});
    ide.page.on('pageerror', error => errors.push(String(error)));
    ide.page.on('dialog', dialog => dialog.accept());
    await ide.page.evaluate(pageRuntime);
  });
  after(async function() {
    if (ide) { await ide.browser.close(); }
    if (server) { await new Promise(resolve => server.close(resolve)); }
  });
  it('runs the real compiler and Spytial without application endpoints', async function() {
    assert.strictEqual(await ide.page.evaluate(() => window.CLIENT_SIDE), true);
    const initialized = await ide.page.evaluate(() => window.__reifyFidelity.init('x = 21'));
    assert.strictEqual(initialized.ok, true, JSON.stringify(initialized));
    const evaluated = await ide.page.evaluate(() => window.__reifyFidelity.inspectExpression('x * 2'));
    assert.strictEqual(evaluated.B, '42', JSON.stringify(evaluated));
    const exported = await ide.page.evaluate(() => window.__reifyFidelity.exportWorkingCase('[list: 1, 2]'));
    assert.strictEqual(exported.verdict, 'exported', JSON.stringify(exported));
    const rendered = await ide.page.evaluate(async datum => {
      const core = window.spytialcore;
      const data = new core.JSONDataInstance(datum);
      const evaluator = new core.Evaluators.SGraphQueryEvaluator();
      evaluator.initialize({sourceData: data});
      const layout = new core.LayoutInstance(core.parseLayoutSpec('constraints: []\ndirectives: []'), evaluator, 0, true).generateLayout(data).layout;
    const graph = document.createElement('webcola-cnd-graph');
      graph.setAttribute('width', '400');
      graph.setAttribute('height', '400');
      document.body.appendChild(graph);
      try {
        await graph.renderLayout(layout);
        return {nodes: layout.nodes.length, rendered: graph.shadowRoot.querySelectorAll('g.node').length};
      } finally { graph.remove(); }
    }, exported.datum);
    assert.ok(rendered.nodes > 0);
    assert.strictEqual(rendered.nodes, rendered.rendered);
    const forbidden = /\/(getAccessToken|login|logout|oauth2callback|current-version|shared-file|shared-program-contents|downloadImg|create-shared-program)(?:[/?]|$)/;
    assert.deepStrictEqual(requests.filter(r => forbidden.test(r.url) || r.method !== 'GET'), []);
  });
  it('recovers unsaved edits after a reload without Google', async function() {
    await ide.page.evaluate(() => CPO.editor.cm.setValue('answer = 12345\nanswer'));
    const before = await ide.page.evaluate(() => ({hash: location.hash, status: document.querySelector('#save-status').textContent}));
    assert.match(before.hash, /draft=/);
    assert.match(before.status, /not saved to Drive/);
    await ide.page.reload({waitUntil: 'domcontentloaded'});
    await ide.page.waitForFunction(() => window.CPO && CPO.editor && !CPO.editor.cm.getOption('readOnly'));
    assert.strictEqual(await ide.page.evaluate(() => CPO.editor.cm.getValue()), 'answer = 12345\nanswer');
    assert.deepStrictEqual(errors, []);
    await ide.page.evaluate(() => CPO.editor.cm.setValue(''));
    await ide.page.reload({waitUntil: 'domcontentloaded'});
    await ide.page.waitForFunction(() => window.CPO && CPO.editor && !CPO.editor.cm.getOption('readOnly'));
    assert.strictEqual(await ide.page.evaluate(() => CPO.editor.cm.getValue()), '', 'An intentionally empty draft must stay empty');
  });

  it('renders standard numeric and collection output after the backend switch', async function() {
    await ide.page.waitForFunction(() => window.__internalRepl && !document.querySelector('#runButton').disabled);
    await ide.page.evaluate(() => CPO.editor.cm.setValue('[list: 1/3, ~1.5, 12345678901234567890, {1; 2}, nothing]'));
    await ide.page.click('#runButton');
    await ide.page.waitForFunction(() => document.querySelector('#output').textContent.includes('12345678901234567890'));
    // Rationals initially show a repeating decimal; clicking exposes the exact fraction.
    await ide.page.click('#output .rationalNumber');
    const output = await ide.page.$eval('#output', el => el.textContent);
    assert.match(output, /1\/3/);
    assert.match(output, /~1\.5/);
    assert.match(output, /nothing/);
    assert.ok(!output.includes('error displaying'), output);
  });

  for (const customOutput of [false, true]) {
    it(`renders a Spytial diagram on standard Pyret ${customOutput ? 'through _output' : 'through SP.diagram'}`, async function() {
      await ide.page.waitForFunction(() => window.__internalRepl && !document.querySelector('#runButton').disabled);
      assert.strictEqual(await ide.page.evaluate(() => typeof window.__internalRepl.runtime.ffi.isVSConstrRender), 'undefined',
        'This test must run against the upstream backend without the fork renderer');
      const source = 'import spytial as SP\nimport valueskeleton as VS\n' + (customOutput
        ? 'data Box: box(n) with:\n method _output(self): VS.vs-value(SP.diagram(self, "")) end\nend\nbox(42)'
        : 'data Box: box(n) end\nSP.diagram(box(42), "")');
      await ide.page.evaluate(code => CPO.editor.cm.setValue(code), source);
      await ide.page.click('#runButton');
      try {
        await ide.page.waitForFunction(() => {
          const graph = document.querySelector('#output webcola-cnd-graph');
          return graph && graph.shadowRoot && graph.shadowRoot.querySelectorAll('g.node').length > 0;
        }, {timeout: 30000});
      } catch (error) {
        throw new Error(error.message + '\n' + await ide.page.$eval('#output', el => el.textContent));
      }
      const result = await ide.page.evaluate(() => {
        const graph = document.querySelector('#output webcola-cnd-graph');
        const container = graph.parentElement.parentElement;
        const imported = window.SpytialPyretCapture.importPyretCapture(container.spytialCapture);
        return { value: imported.values.get('value').dict.n, source: container.querySelector('pre').textContent,
          typeId: imported.values.get('value').$name,
          typeLabels: Array.from(graph.shadowRoot.querySelectorAll('.mostSpecificTypeLabel'), el => el.textContent) };
      });
      assert.strictEqual(result.value, 42);
      assert.strictEqual(result.source, 'box(42)');
      assert.match(result.typeId, /^pyret:constructor:/, 'The portable snapshot retains nominal identity');
      assert.ok(result.typeLabels.includes('box'), JSON.stringify(result.typeLabels));
      assert.ok(!result.typeLabels.some(label => label.includes('pyret:constructor:')));
      assert.deepStrictEqual(errors, []);
    });
  }
  it('imports a local file as a separate recoverable draft', async function() {
    const filename = path.resolve(__dirname, '../../build/local-import-test.arr');
    fs.writeFileSync(filename, 'use context starter2024\nlocal-answer = 42\n');
    const previous = await ide.page.evaluate(() => location.hash);
    await (await ide.page.$('#local-file-input')).uploadFile(filename);
    await ide.page.waitForFunction(() => CPO.editor.cm.getValue().includes('local-answer = 42'));
    assert.notStrictEqual(await ide.page.evaluate(() => location.hash), previous);
    assert.match(await ide.page.title(), /local-import-test.arr/);
    await ide.page.screenshot({path: path.resolve(__dirname, '../../build/static-smoke.png')});
  });
  it('contains only public deployment configuration', function() {
    const config = publicConfig({GOOGLE_CLIENT_SECRET: 'SECRET_MUST_NOT_SHIP', SESSION_SECRET: 'SESSION_MUST_NOT_SHIP',
      GOOGLE_CLIENT_ID: 'public-client', GOOGLE_API_KEY: 'public-key', STATIC_BASE_PATH: '/spyret'});
    assert.strictEqual(config.PYRET, '/spyret/js/cpo-main.jarr.js');
    assert.ok(!JSON.stringify(config).includes('MUST_NOT_SHIP'));
    const html = fs.readFileSync(path.resolve(__dirname, '../../build/static/editor/index.html'), 'utf8');
    assert.ok(!html.includes('{{'), 'All HTML configuration is resolved at build time');
  });
  it('saves through the real client adapter and reconnects without overwriting edits (simulated Google)', async function() {
    await ide.page.evaluate(async () => {
      // Emulate Google's discovery/request and GIS interfaces, not Spyret's
      // storage adapter. This exercises the full UI -> wrapper -> Drive path.
      window.GOOGLE_CLIENT_ID = 'test-client';
      window.apiKey = 'test-api-key';
      const state = window.fakeGoogle = {file: null, uploads: [], creates: 0, token: null, failUpload: true};
      function request(result) { return {execute(callback) { setTimeout(() => callback(typeof result === 'function' ? result() : result), 0); }}; }
      const realFetch = window.fetch.bind(window);
      window.fetch = (url, options) => {
        if (url.startsWith('https://www.googleapis.com/drive/v2/files/saved-file?')) {
          return Promise.resolve(new Response(JSON.stringify(state.file), {status: 200}));
        }
        return realFetch(url, options);
      };
      const drive = {
        files: {
          list: () => request({items: [{id: 'folder'}]}),
          get: () => request(() => state.file),
          update: args => request(() => Object.assign(state.file, args.resource))
        }
      };
      window.gapi = {
        load: (_, options) => options.callback(),
        client: {
          setApiKey() {}, setToken: token => { state.token = token; }, getToken: () => state.token,
          load: name => { gapi.client[name] = drive; return Promise.resolve(); },
          request: args => request(() => {
            if (args.method === 'POST') {
              state.creates++;
              state.file = {id: 'saved-file', title: args.body.title, mimeType: 'text/plain'};
              return state.file;
            }
            if (args.method === 'PUT') {
              if (state.failUpload) { return {code: 500, message: 'Simulated upload failure'}; }
              state.uploads.push(args.body.split('Content-Type: text/plain\r\n\r\n')[1].split('\r\n--')[0]);
              return state.file;
            }
            throw new Error('Unexpected request: ' + args.method + ' ' + args.path);
          })
        }
      };
      window.google = {picker: {}, accounts: {oauth2: {
        initTokenClient: config => ({requestAccessToken() {
          config.callback({access_token: 'simulated-token', expires_in: 3600, scope: config.scope});
        }})
      }}};
      await BrowserGoogleAuth.load();
    });
    await ide.page.click('#connectButton');
    await ide.page.waitForFunction(() => BrowserGoogleAuth.current() && !document.querySelector('#connectButton').disabled);
    const failed = await ide.page.evaluate(async () => {
      CPO.editor.cm.setValue('local edit before upload');
      try { await CPO.save(); return false; } catch (_) { return true; }
    });
    assert.strictEqual(failed, true);
    assert.strictEqual(await ide.page.evaluate(() => fakeGoogle.creates), 1);
    await ide.page.evaluate(async () => { fakeGoogle.failUpload = false; await CPO.save(); });
    assert.strictEqual(await ide.page.evaluate(() => fakeGoogle.creates), 1, 'Retry must not create a duplicate file');
    await ide.page.evaluate(() => {
      BrowserGoogleAuth.clear();
      CPO.editor.cm.setValue('edited while disconnected');
    });
    await ide.page.click('#connectButton');
    await ide.page.waitForFunction(() => BrowserGoogleAuth.current() && !document.querySelector('#connectButton').disabled);
    assert.strictEqual(await ide.page.evaluate(() => CPO.editor.cm.getValue()), 'edited while disconnected');
    await ide.page.evaluate(() => CPO.save());
    assert.strictEqual(await ide.page.evaluate(() => fakeGoogle.uploads.at(-1)), 'edited while disconnected');
    assert.strictEqual(await ide.page.$eval('#save-status', el => el.textContent), 'Saved to Drive');
    const persisted = await ide.page.evaluate(() => JSON.stringify({...localStorage, ...sessionStorage}));
    assert.ok(!persisted.includes('simulated-token'));
    await ide.page.click('#shareContainer button');
    await ide.page.waitForFunction(() => document.querySelector('#promptModal').style.display !== 'none' &&
      document.querySelector('#promptModal .auto-highlight'));
    const links = await ide.page.$$eval('#promptModal .auto-highlight', inputs => inputs.map(input => input.value));
    assert.strictEqual(links[0], origin + '/editor/#share=saved-file');
    assert.strictEqual(links[1], 'https://drive.google.com/file/d/saved-file/view');
    assert.match(await ide.page.$eval('#promptModal', el => el.textContent), /Recipients need access/);
    await ide.page.click('#promptModal .submit');
  });
});
