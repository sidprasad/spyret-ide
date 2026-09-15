'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const puppeteer = require('puppeteer-core');
const {findChrome} = require('../pyret-round-trip/browser');
const source = file => fs.readFileSync(path.resolve(__dirname, '../../src/web/js', file), 'utf8');

describe('static sharing URLs', function() {
  for (const base of ['', '/spyret']) {
    it('preserves the hosting path and resource key at ' + (base || '/'), function() {
      const context = {CLIENT_SIDE: true, APP_BASE_URL: base,
        location: {origin: 'https://sidprasad.github.io'}, $: () => ({click() {}})};
      context.window = context;
      vm.runInNewContext(source('share.js'), context);
      const url = context.makeShareAPI('').makeShareUrl('file-id', 'key+value');
      assert.strictEqual(url, 'https://sidprasad.github.io' + base + '/editor/#share=file-id&resourcekey=key%2Bvalue');
    });
  }
});

describe('shared Drive links in the browser (simulated Google)', function() {
  this.timeout(30000);
  let browser, page;
  before(async function() {
    browser = await puppeteer.launch({executablePath: findChrome(), headless: 'new', args: ['--no-sandbox']});
  });
  afterEach(async function() { if (page) { await page.close(); page = null; } });
  after(async function() { if (browser) { await browser.close(); } });

  async function recipient({allowed = true, publicFile = false, denyContents = false} = {}) {
    const requests = [];
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.hostname === 'spyret.test') {
        return request.respond({status: 200, contentType: 'text/html', body: `<!doctype html><html><body>
          <div id="welcome"><span class="username-message"></span></div>
          <div id="publishli"></div><div id="filemenuContents"></div>
          <div id="connectButtonli"><button id="connectButton"></button></div>
          <div id="username"></div><div id="logout"><a></a></div>
          <ul><li><a id="new"></a></li></ul><div id="programs"><a></a></div>
          <div id="fullConnectButton"><a></a></div></body></html>`});
      }
      const headers = {'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization,x-goog-drive-resource-keys'};
      if (request.method() === 'OPTIONS') { return request.respond({status: 204, headers}); }
      requests.push({url: request.url(), method: request.method(), headers: request.headers()});
      const hasKey = request.headers()['x-goog-drive-resource-keys'] === 'shared-file/link-key';
      const hasAccess = publicFile || (allowed && request.headers().authorization === 'Bearer recipient-token');
      const media = url.searchParams.get('alt') === 'media';
      const ok = hasKey && hasAccess && !(denyContents && media);
      return request.respond({status: ok ? 200 : 404, headers,
        contentType: media ? 'text/plain' : 'application/json',
        body: ok ? (media ? 'shared-answer = 42' : JSON.stringify({id: 'shared-file', title: 'Shared example', mimeType: 'text/plain'})) :
          JSON.stringify({error: {code: 404, message: 'File not found'}})});
    });
    await page.goto('https://spyret.test/spyret/editor/#share=shared-file&resourcekey=link-key');
    await page.addScriptTag({path: require.resolve('jquery')});
    await page.addScriptTag({path: require.resolve('q')});
    await page.evaluate(() => {
      localStorage.clear();
      window.CLIENT_SIDE = true;
      window.APP_BASE_URL = '/spyret';
      window.GOOGLE_CLIENT_ID = 'public-client';
      window.apiKey = 'public-key';
      window.errors = [];
      window.stickError = message => errors.push(message);
      window.FilePicker = function() {};
      // Simulate only Google and the editor widget. Run the real authorization,
      // API wrapper, Drive adapter, and session code below.
      const state = window.state = {token: null, value: '', listeners: [], mutations: []};
      window.gapi = {client: {
        setApiKey() {}, getToken: () => state.token, setToken: token => { state.token = token; },
        load: name => {
          gapi.client[name] = {files: {
            list: () => ({execute: callback => callback({items: [{id: 'folder'}]})})
          }};
          return Promise.resolve();
        },
        request: args => {
          state.mutations.push(args);
          return {execute: callback => callback({id: 'recipient-copy', title: 'My copy', mimeType: 'text/plain'})};
        }
      }};
      window.google = {accounts: {oauth2: {initTokenClient: config => ({requestAccessToken() {
        config.callback({access_token: 'recipient-token', expires_in: 3600, scope: config.scope});
      }})}}};
      window.CPO = {editor: {cm: {
        getValue: () => state.value,
        setValue: value => { state.value = value; state.listeners.forEach(fn => fn()); },
        on: (_, fn) => state.listeners.push(fn), clearHistory() {}
      }}};
    });
    for (const file of ['google-apis/api-wrapper.js', 'google-apis/browser-auth.js', 'google-apis/drive.js']) {
      await page.addScriptTag({content: source(file)});
    }
    await page.addScriptTag({content: '(function() { var module = {};\n' + source('client-session.js') +
      '\nwindow.newSession = module.exports; })();'});
    await page.evaluate(async () => {
      window.session = newSession({updateName: file => { document.title = file.getName(); }, setLocalName: name => { document.title = name; }});
      state.value = await session.initial('use context starter2024');
      session.attach();
      await BrowserGoogleAuth.load();
      document.querySelector('#connectButton').onclick = () => session.connect(false);
    });
    return requests;
  }

  async function connect() {
    await page.click('#connectButton');
    await page.waitForFunction(() => !document.querySelector('#connectButton').disabled);
  }

  it('opens a private link after connecting as an allowed recipient, retaining the resource key', async function() {
    const requests = await recipient();
    assert.strictEqual(await page.evaluate(() => state.value), 'use context starter2024');
    await connect();
    assert.strictEqual(await page.evaluate(() => state.value), 'shared-answer = 42');
    assert.strictEqual(await page.title(), 'Shared example');
    assert.strictEqual(await page.$eval('#save-status', el => el.textContent), 'Viewing a shared program');
    assert.deepStrictEqual(await page.evaluate(() => state.mutations), []);
    assert.ok(requests.some(r => r.url.includes('/v2/') && r.headers.authorization === 'Bearer recipient-token'));
    assert.ok(requests.some(r => r.url.includes('alt=media') && r.headers.authorization === 'Bearer recipient-token'));
    assert.ok(requests.every(r => r.headers['x-goog-drive-resource-keys'] === 'shared-file/link-key'));
    assert.ok(requests.every(r => r.method === 'GET' && r.url.startsWith('https://www.googleapis.com/drive/')));
    await page.evaluate(() => { BrowserGoogleAuth.clear(); CPO.editor.cm.setValue('local changes'); });
    await connect();
    assert.strictEqual(await page.evaluate(() => state.value), 'local changes');
    await page.evaluate(() => session.autoSave());
    assert.deepStrictEqual(await page.evaluate(() => state.mutations), [], 'Shared edits must not overwrite the owner file');
  });

  it('shows an access error for a denied recipient and preserves local edits', async function() {
    await recipient({allowed: false});
    await page.evaluate(() => CPO.editor.cm.setValue('local work'));
    await connect();
    assert.strictEqual(await page.evaluate(() => state.value), 'local work');
    assert.match(await page.$eval('#save-status', el => el.textContent), /account with access/);
    assert.strictEqual(await page.evaluate(async () => await session.currentFile()), null);
    assert.deepStrictEqual(await page.evaluate(() => state.mutations), []);
  });

  it('does not adopt or report a loaded file when content downloads are forbidden', async function() {
    await recipient({denyContents: true});
    await connect();
    assert.strictEqual(await page.evaluate(() => state.value), 'use context starter2024');
    assert.strictEqual(await page.evaluate(async () => await session.currentFile()), null);
    assert.match(await page.$eval('#save-status', el => el.textContent), /account with access/);
  });

  it('opens a public link anonymously without changing any Drive permissions', async function() {
    const requests = await recipient({publicFile: true});
    assert.strictEqual(await page.evaluate(() => state.value), 'shared-answer = 42');
    assert.ok(requests.every(r => !r.headers.authorization));
    assert.deepStrictEqual(await page.evaluate(() => state.mutations), []);
    assert.ok(!(await page.evaluate(() => BrowserGoogleAuth.current())));
  });

  it('saves shared edits into the recipient’s own copy', async function() {
    await recipient();
    await connect();
    await page.evaluate(async () => {
      CPO.editor.cm.setValue('my changes = 123');
      await session.save('My copy');
    });
    const writes = await page.evaluate(() => state.mutations);
    assert.strictEqual(writes.length, 2);
    assert.strictEqual(writes[0].method, 'POST');
    assert.strictEqual(writes[0].path, '/drive/v2/files');
    assert.strictEqual(writes[1].method, 'PUT');
    assert.strictEqual(writes[1].path, '/upload/drive/v2/files/recipient-copy');
    assert.ok(writes[1].body.includes('my changes = 123'));
    assert.strictEqual(await page.evaluate(() => location.hash), '#program=recipient-copy');
    assert.strictEqual(await page.$eval('#save-status', el => el.textContent), 'Saved to Drive');
  });
});
