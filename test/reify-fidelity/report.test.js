'use strict';

const assert = require('assert');
const { isViolation, summarize } = require('./report');

describe('Fidelity report validity', function () {
  const unsupported = { source: 'corpus', category: 'object', name: 'flat', expect: 'unsupported', failure: 'reify-eval-error' };

  it('accepts only the declared failure stage for an unsupported value', function () {
    assert.strictEqual(isViolation({ ...unsupported, verdict: 'reify-eval-error' }), false);
    for (const verdict of ['pass', 'value-error', 'relationalize-error', 'decode-error', 'mismatch']) {
      assert.strictEqual(isViolation({ ...unsupported, verdict }), true, verdict);
    }
  });

  it('requires unsupported rows to specify an actual comparison failure', function () {
    for (const failure of [undefined, 'value-error', 'relationalize-error', 'decode-error']) {
      assert.strictEqual(isViolation({ ...unsupported, failure, verdict: failure }), true);
    }
  });

  it('accepts only an explicitly declared reifier rejection with its exact message', function () {
    const rejected = { ...unsupported, failure: 'reify-error', verdict: 'reify-error',
      failureMessage: 'Error: Incomplete Pyret constructor fields',
      error: 'Error: Incomplete Pyret constructor fields' };
    assert.strictEqual(isViolation(rejected), false);
    assert.strictEqual(isViolation({ ...rejected, failureMessage: undefined }), true);
    assert.strictEqual(isViolation({ ...rejected, error: 'Error: unrelated bug' }), true);
    assert.strictEqual(isViolation({ ...rejected, verdict: 'decode-error' }), true);
    assert.strictEqual(isViolation({ ...rejected, verdict: 'pass' }), true);
    assert.strictEqual(isViolation({ ...rejected, expect: 'supported' }), true);
    assert.strictEqual(isViolation({ ...rejected, source: 'generated' }), true);
  });

  it('does not report an empty or incomplete run as successful', function () {
    assert.strictEqual(summarize([]).boundaryHolds, false);
    assert.strictEqual(summarize([]).corpusPassRate, null);
    const rows = [{ ...unsupported, verdict: 'reify-eval-error' }];
    assert.strictEqual(summarize(rows, { expectedCases: ['object/flat', 'data/tree'] }).boundaryHolds, false);
    assert.strictEqual(summarize(rows, { numRuns: 1 }).boundaryHolds, false);
    rows.push({ source: 'generated', verdict: 'pass' });
    assert.strictEqual(summarize(rows, { expectedCases: ['object/flat'], numRuns: 1 }).boundaryHolds, true);
  });

  it('rejects a generated failure even when enough examples ran', function () {
    assert.strictEqual(summarize([{ source: 'generated', verdict: 'mismatch' }], { numRuns: 1 }).boundaryHolds, false);
  });
});
