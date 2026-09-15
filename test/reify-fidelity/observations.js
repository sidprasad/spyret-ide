'use strict';

const { PRELUDE, ROWS } = require('./corpus');

// This is an additional observation, not a different meaning of torepr fidelity.
// For acyclic tables, inspect the ordered headers and rows recursively. Cyclic
// table cells have bounded identity/mutation observations instead.
const SNAPSHOT = `
fun table-snapshot(v):
  if is-table(v):
    {v.column-names(); for map(r from v.all-rows()):
      for map(c from v.column-names()): table-snapshot(r.get-value(c)) end
    end}
  else: v end
end
`;
function observation(category, name, fixtureId, observe, expected) {
  const fixture = ROWS.find(r => `${r.category}/${r.name}` === fixtureId);
  if (!fixture) throw new Error('Unknown observation fixture: ' + fixtureId);
  return { id: `${category}/${name}`, category, name, fixtureId, expr: fixture.expr,
    prelude: PRELUDE + SNAPSHOT, observe, expected, expect: 'supported', desiredVerdict: 'pass' };
}

const OBSERVATIONS = [
  ...['empty', 'zero-columns', 'rows-and-duplicates', 'nested-cells', 'nested-table', 'unusual-headers', 'shared-array']
    .map(name => observation('table-content', name, `table/${name}`, 'table-snapshot')),
  observation('table-behavior', 'shared-array', 'table/shared-array', `lam(t) block:
    a = t.row-n(0).get-value("a")
    b = t.row-n(0).get-value("b")
    same = identical(a, b)
    raw-array-set(a, 0, 9)
    same and (raw-array-get(b, 0) == 9)
  end`, 'true'),
  observation('table-behavior', 'reference-cycle', 'table/reference-cycle',
    'lam(t): identical(t.row-n(0).get-value("a")!next, t) end', 'true'),
  observation('table-behavior', 'dictionary-cycle', 'table/dictionary-cycle',
    'lam(t): identical(t.row-n(0).get-value("a").get-value-now("table"), t) end', 'true'),
  observation('table-behavior', 'operations', 'table/rows-and-duplicates', `lam(t):
    {t.length(); t.add-row(t.row("New", 9)).length(); t.drop("score").column-names()}
  end`, '{ 3; 4; [list: "name"] }'),
  observation('reference-behavior', 'self-cycle', 'cycle/ref-cycle',
    'lam(c): identical(c!next, c) end', 'true'),
  observation('reference-behavior', 'two-cells', 'cycle/two-cells',
    'lam(c): identical((c!next)!next, c) and not(identical(c!next, c)) end', 'true'),
  observation('reference-behavior', 'shared-cell', 'ref/shared-cell', `lam(v) block:
    same = identical(v.a, v.b)
    separate = not(identical(v.a, v.separate))
    v.a!{next: 9}
    same and separate and (v.b!next == 9) and (v.separate!next == 5)
  end`, 'true'),
  observation('dictionary-behavior', 'self-cycle', 'dictionary/self-cycle',
    'lam(d): identical(d.get-value-now("self"), d) end', 'true'),
  { ...observation('dictionary-behavior', 'shared-array', 'dictionary/shared-array', `lam(d) block:
    a = d.get-value("a")
    b = d.get-value("b")
    same = identical(a, b)
    raw-array-set(a, 0, 9)
    same and (raw-array-get(b, 0) == 9)
  end`, 'true'), expect: 'pending',
    note: 'Core 6.0.1 preserves the shared array atom but emits two literals for an immutable dictionary; inspection matches while mutation through aliases fails.' },
];

module.exports = { OBSERVATIONS };
