'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

describe('Published Spyret asset', function () {
  it('matches the installed npm package, lockfile integrity and content fingerprint', function () {
    const directory = path.resolve(__dirname, '../../lib/js');
    const pin = JSON.parse(fs.readFileSync(path.join(directory, 'spytial-pyret-capture.json'), 'utf8'));
    const locked = require('../../package-lock.json').packages['node_modules/spyret'];
    assert.strictEqual(pin.package, 'spyret');
    assert.strictEqual(pin.version, require('../../package.json').dependencies.spyret);
    assert.strictEqual(pin.version, locked.version);
    assert.strictEqual(pin.resolved, locked.resolved);
    assert.strictEqual(pin.integrity, locked.integrity);
    assert.match(pin.resolved, /^https:\/\/registry\.npmjs\.org\/spyret\/-\//);
    const bytes = fs.readFileSync(path.join(directory, 'spytial-pyret-capture.js'));
    assert.ok(bytes.equals(fs.readFileSync(require.resolve('spyret/global'))));
    assert.strictEqual(createHash('sha256').update(bytes).digest('hex'), pin.sha256);
    const html = fs.readFileSync(path.resolve(__dirname, '../../src/web/editor.html'), 'utf8');
    assert.ok(html.includes('/js/spytial-pyret-capture.js'));
  });
});
