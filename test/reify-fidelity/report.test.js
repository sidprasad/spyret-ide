'use strict';

const assert = require('assert');
const { isViolation, summarize } = require('./report');
const { ROWS } = require('./corpus');

describe('Desired fidelity report validity', function () {
  const pending = { source: 'corpus', category: 'object', name: 'flat', expect: 'pending', desiredVerdict: 'pass' };
  const supported = { source: 'corpus', category: 'data', name: 'tree', expect: 'supported', verdict: 'pass' };

  it('requires exact round trips for every desired case, including pending features', function () {
    for (const row of ROWS.filter(r => r.expect !== 'out-of-scope')) {
      assert.strictEqual(row.desiredVerdict, 'pass');
      assert.strictEqual(row.failure, undefined);
    }
    assert.strictEqual(isViolation({ ...pending, verdict: 'pass' }), false);
    for (const verdict of ['mismatch', 'value-error', 'relationalize-error', 'decode-error', 'reify-error', 'reify-eval-error']) {
      assert.strictEqual(isViolation({ ...pending, verdict }), true, verdict);
    }
  });

  it('does not count matching a known error as success', function () {
    const row = { ...pending, failure: 'reify-error', verdict: 'reify-error',
      failureMessage: 'Error: Incomplete Pyret constructor fields',
      error: 'Error: Incomplete Pyret constructor fields' };
    assert.strictEqual(isViolation(row), true);
    assert.strictEqual(summarize([row]).fidelityHolds, false);
  });

  it('separates green implemented checks from unverified pending requirements', function () {
    const summary = summarize([supported], {
      expectedCases: ['data/tree', 'object/flat'], pendingCases: ['object/flat'],
    });
    assert.strictEqual(summary.requiredChecksHold, true);
    assert.strictEqual(summary.complete, false);
    assert.strictEqual(summary.fidelityHolds, false);
    assert.deepStrictEqual(summary.pendingCases, ['object/flat']);
    assert.strictEqual(summary.counts.pending, 1);
  });

  it('never excuses a measured pending failure or a missing implemented case', function () {
    const meta = { expectedCases: ['data/tree', 'object/flat'], pendingCases: ['object/flat'] };
    assert.strictEqual(summarize([{ ...pending, verdict: 'mismatch' }], meta).requiredChecksHold, false);
    assert.strictEqual(summarize([supported, { ...pending, verdict: 'mismatch' }], meta).requiredChecksHold, false);
    assert.strictEqual(summarize([supported, { ...pending, verdict: 'pass' }], meta).fidelityHolds, true);
  });

  it('rejects empty, duplicate, unexpected, and incomplete generated runs', function () {
    assert.strictEqual(summarize([]).requiredChecksHold, false);
    assert.strictEqual(summarize([]).fidelityHolds, false);
    assert.strictEqual(summarize([supported, supported]).fidelityHolds, false);
    assert.strictEqual(summarize([supported], { expectedCases: ['object/flat'] }).fidelityHolds, false);
    assert.strictEqual(summarize([supported], { numRuns: 1 }).requiredChecksHold, false);
    assert.strictEqual(summarize([supported], { pendingCases: ['unknown'] }).requiredChecksHold, false);
    assert.strictEqual(summarize([{ source: 'generated', verdict: 'mismatch' }], { numRuns: 1 }).fidelityHolds, false);
  });

  it('does not report success after an isolation or orchestration failure', function () {
    const summary = summarize([supported], { runErrors: ['cache isolation failed'] });
    assert.strictEqual(summary.requiredChecksHold, false);
    assert.strictEqual(summary.fidelityHolds, false);
    assert.deepStrictEqual(summary.runErrors, ['cache isolation failed']);
  });
});
