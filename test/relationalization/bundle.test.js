'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

describe('Pinned Spyret asset', function () {
  it('matches the recorded source revision and content fingerprint', function () {
    const directory = path.resolve(__dirname, '../../lib/js');
    const pin = JSON.parse(fs.readFileSync(path.join(directory, 'spytial-pyret-capture.json'), 'utf8'));
    assert.match(pin.revision, /^[0-9a-f]{40}$/);
    assert.strictEqual(pin.repository, 'https://github.com/sidprasad/spyret');
    const bytes = fs.readFileSync(path.join(directory, 'spytial-pyret-capture.js'));
    assert.strictEqual(createHash('sha256').update(bytes).digest('hex'), pin.sha256);
    const html = fs.readFileSync(path.resolve(__dirname, '../../src/web/editor.html'), 'utf8');
    assert.ok(html.includes('/js/spytial-pyret-capture.js'));
  });
});
