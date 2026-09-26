'use strict';
const assert = require('assert');
const { summarize } = require('./report');
const { fixtures } = require('./corpus');
const fs = require('fs');
const path = require('path');

describe('Released core integration configuration', function () {
  it('pins all three production Spytial assets to the tested release', function () {
    const html = fs.readFileSync(path.resolve(__dirname, '../../src/web/editor.html'), 'utf8');
    const urls = html.match(/https:\/\/cdn\.jsdelivr\.net\/npm\/spytial-core@[^" ]+/g);
    assert.deepStrictEqual(urls, [
      'browser/spytial-core-complete.global.js',
      'components/react-component-integration.global.js',
      'components/react-component-integration.css',
    ].map(file => 'https://cdn.jsdelivr.net/npm/spytial-core@6.3.2/dist/' + file));
  });
  it('includes all 33 fixed fixtures without needing a local-core override', function () {
    const cases = fixtures();
    assert.strictEqual(cases.length, 33);
    for (const id of ['unicode-normalization-root', 'unicode-normalization-field', 'same-field-different-position']) {
      assert.ok(cases.some(c => c.id === id), id);
    }
  });
});

describe('Working round-trip report validity', function () {
  it('requires every planned case to succeed exactly once', function () {
    assert.strictEqual(summarize(['a'], [{ id: 'a', verdict: 'pass' }]).fidelityHolds, true);
    for (const rows of [[], [{ id: 'b', verdict: 'pass' }],
      [{ id: 'a', verdict: 'pass' }, { id: 'a', verdict: 'pass' }]]) {
      assert.strictEqual(summarize(['a'], rows).fidelityHolds, false);
    }
    assert.strictEqual(summarize([], []).fidelityHolds, false);
  });
  it('does not turn recorded baseline gaps into fidelity successes', function () {
    const r = summarize(['a'], [{ id: 'a', verdict: 'mismatch' }]);
    assert.strictEqual(r.complete, true);
    assert.strictEqual(r.fidelityHolds, false);
  });
  it('does not substitute shrink attempts for missing planned cases', function () {
    assert.strictEqual(summarize(['a', 'b'], [
      { id: 'a', verdict: 'pass' }, { id: 'shrink-0', verdict: 'pass' },
    ]).fidelityHolds, false);
  });
  it('fails a complete-looking run when an orchestration error occurred', function () {
    assert.strictEqual(summarize(['a'], [{ id: 'a', verdict: 'pass' }], ['initialization failed']).fidelityHolds, false);
  });
});
