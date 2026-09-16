'use strict';
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const Q = require('q');

function authHarness() {
  let now = 1000, config, requested = 0, googleToken;
  const events = {}, timers = new Map();
  const context = {Q, Promise, console, CLIENT_SIDE: true, GOOGLE_CLIENT_ID: 'client', apiKey: 'key',
    Date: {now: () => now}, CustomEvent: function(type) { this.type = type; },
    setTimeout(fn) { timers.set(timers.size + 1, fn); return timers.size; }, clearTimeout(id) { timers.delete(id); },
    addEventListener(type, fn) { (events[type] ||= []).push(fn); },
    dispatchEvent(e) { (events[e.type] || []).forEach(fn => fn(e)); },
    gapi: {client: {setApiKey() {}, setToken(t) { googleToken = t; }}},
    google: {accounts: {oauth2: {initTokenClient(c) {
      config = c;
      return {requestAccessToken() { requested++; }};
    }}}}
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../src/web/js/google-apis/browser-auth.js'), 'utf8'), context);
  return {auth: context.BrowserGoogleAuth, context, config: () => config,
    requested: () => requested, googleToken: () => googleToken,
    advance: n => { now += n; }};
}

describe('browser Google authorization', function() {
  it('never opens a popup on startup or expiry, and clears expired credentials', async function() {
    const h = authHarness();
    await h.auth.load();
    assert.strictEqual(await h.auth.authorize(true), undefined);
    assert.strictEqual(h.requested(), 0);
    const grant = h.auth.authorize(false);
    assert.strictEqual(h.requested(), 1, 'Popup must start in the user click stack');
    h.config().callback({access_token: 'access-only', expires_in: 3600, scope: h.config().scope});
    await grant;
    assert.strictEqual(h.auth.current().access_token, 'access-only');
    h.advance(3600000);
    assert.strictEqual(await h.auth.authorize(true), null);
    assert.strictEqual(h.googleToken(), null);
    assert.strictEqual(h.requested(), 1);
  });
  it('requires the read and save grants instead of accepting partial consent', async function() {
    const h = authHarness();
    await h.auth.load();
    assert.match(h.config().scope, /drive\.readonly/);
    const grant = h.auth.authorize(false);
    h.config().callback({access_token: 'partial', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file'});
    await assert.rejects(Promise.resolve(grant), /not fully granted/);
    assert.ok(!h.auth.current());
    assert.ok(!h.googleToken());
  });
  it('settles cancellation and denied consent, allowing a later retry', async function() {
    const h = authHarness();
    await h.auth.load();
    const cancel = h.auth.authorize(false);
    h.config().error_callback({type: 'popup_closed'});
    await assert.rejects(Promise.resolve(cancel), /cancelled/);
    const denied = h.auth.authorize(false);
    h.config().callback({error: 'access_denied'});
    await assert.rejects(Promise.resolve(denied), /access_denied/);
    assert.ok(!h.auth.current());
    const retry = h.auth.authorize(false);
    h.config().callback({access_token: 'retry', expires_in: 3600, scope: h.config().scope});
    assert.strictEqual((await retry).access_token, 'retry');
  });
});

describe('anonymous Google requests', function() {
  it('does not restore a disconnected token after an anonymous request', async function() {
    const timers = [];
    let current = {access_token: 'old'}, providerToken = current;
    const context = {Q, console, CLIENT_SIDE: true, apiKey: 'public', $: {extend: Object.assign},
      setTimeout: fn => timers.push(fn),
      BrowserGoogleAuth: {authorize: () => Q(current), current: () => current},
      gapi: {client: {
        getToken: () => providerToken, setToken: value => { providerToken = value; },
        load: function(name) {
          this[name] = {files: {get: args => ({execute: callback => callback({id: args.fileId})})}};
          return Q();
        }
      }}};
    context.window = context;
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../src/web/js/google-apis/api-wrapper.js'), 'utf8'), context);
    const drive = await context.gwrap.load({name: 'drive', version: 'v2', reauth: {immediate: true}});
    await drive.files.get({fileId: 'public-file'}, true);
    current = null;
    timers.forEach(fn => fn());
    assert.strictEqual(providerToken, null);
  });
});
