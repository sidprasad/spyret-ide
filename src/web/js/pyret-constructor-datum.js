/* Experimental Pyret constructor-data adapter. See test/constructor-data/README.md. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PyretConstructorDatum = factory();
}(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const MIN_INTEGER = -2147483648;
  const MAX_INTEGER = 2147483647;
  const VALUE_TYPES = ['CDInteger', 'CDString', 'CDBoolean', 'CDSingleton', 'CDConstructor'];

  class UnsupportedValue extends Error {
    constructor(reason, path) {
      super(reason + ' at ' + path);
      this.name = 'UnsupportedValue';
      this.reason = reason;
      this.path = path;
    }
  }

  // No torepr, _output, skeleton, source expression, or constructor cache is
  // consulted here. Only the runtime's structural tags and ordered field names.
  function exportValue(rt, value) {
    const atoms = [];
    const atomById = new Map();
    const relations = [
      { id: 'cdRoot', name: 'cdRoot', types: ['CDValue'], tuples: [] },
      { id: 'cdArity', name: 'cdArity', types: ['CDConstructor', 'CDPosition'], tuples: [] },
      { id: 'cdField', name: 'cdField', types: ['CDConstructor', 'CDPosition', 'CDFieldName', 'CDValue'], tuples: [] },
    ];
    const seen = new WeakMap();
    const active = new WeakSet();
    const metadata = new Map();
    function atom(type, label) {
      const a = { id: 'cd' + atoms.length, type, label };
      atoms.push(a);
      atomById.set(a.id, a);
      return a.id;
    }
    function meta(type, label) {
      const key = JSON.stringify([type, label]);
      if (!metadata.has(key)) metadata.set(key, atom(type, label));
      return metadata.get(key);
    }
    function tuple(index, ids) {
      relations[index].tuples.push({ atoms: ids, types: ids.map(id => atomById.get(id).type) });
    }
    function visit(v, path) {
      if (typeof v === 'string') return atom('CDString', v);
      if (typeof v === 'boolean') return atom('CDBoolean', String(v));
      if (rt.isNumber(v)) {
        if (typeof v !== 'number' || !Number.isInteger(v) || v < MIN_INTEGER || v > MAX_INTEGER) {
          throw new UnsupportedValue('integer-domain', path);
        }
        return atom('CDInteger', String(v));
      }
      if (rt.isRef(v)) throw new UnsupportedValue('mutable-reference', path);
      if (!rt.isDataValue(v)) throw new UnsupportedValue('not-constructor-data', path);
      if (v.dict._output && rt.isMethod(v.dict._output)) {
        throw new UnsupportedValue('custom-output', path);
      }
      if (active.has(v)) throw new UnsupportedValue('cycle', path);
      if (seen.has(v)) return seen.get(v);

      const fields = v.$constructor && v.$constructor.$fieldNames || [];
      const singleton = v.$arity === -1;
      if (typeof v.$name !== 'string' || !v.$name || !Array.isArray(fields)
          || !fields.every(f => typeof f === 'string') || new Set(fields).size !== fields.length
          || (singleton ? fields.length !== 0 : v.$arity !== fields.length)) {
        throw new UnsupportedValue('constructor-metadata', path);
      }
      if (v.$mut_fields_mask && v.$mut_fields_mask.some(Boolean)) {
        throw new UnsupportedValue('mutable-reference', path);
      }
      const id = atom(singleton ? 'CDSingleton' : 'CDConstructor', v.$name);
      seen.set(v, id);
      active.add(v);
      if (!singleton) tuple(1, [id, meta('CDPosition', String(fields.length))]);
      fields.forEach((field, index) => {
        const child = visit(v.dict[field], path + '.' + field);
        tuple(2, [id, meta('CDPosition', String(index)), meta('CDFieldName', field), child]);
      });
      active.delete(v);
      return id;
    }
    tuple(0, [visit(value, '$')]);
    const types = Array.from(new Set(atoms.map(a => a.type))).map(type => ({
      id: type, types: VALUE_TYPES.includes(type) ? [type, 'CDValue'] : [type],
      atoms: atoms.filter(a => a.type === type), isBuiltin: false,
    }));
    types.push({ id: 'CDValue', types: ['CDValue'], atoms: [], isBuiltin: false });
    return { atoms, relations, types };
  }

  // Pyret _torepr escapes UTF-16 code units, not Unicode code points. Unlike
  // JSON.stringify it escapes every non-ASCII unit with uppercase hex digits.
  function quoteString(value) {
    let result = '"';
    const escapes = { 9: '\\t', 10: '\\n', 13: '\\r', 34: '\\"', 92: '\\\\' };
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      result += escapes[code] || (code >= 32 && code <= 126 ? value[i]
        : '\\u' + code.toString(16).toUpperCase().padStart(4, '0'));
    }
    return result + '"';
  }

  // A direct string decoder: deliberately has no Pyret runtime or evaluation.
  // Accept either JSON or the public, read-only data-instance interface.
  function inspectDatum(datum) {
    const atoms = typeof datum.getAtoms === 'function' ? datum.getAtoms() : datum.atoms;
    const relations = typeof datum.getRelations === 'function' ? datum.getRelations() : datum.relations;
    function requireThat(condition, message) {
      if (!condition) throw new Error('Invalid constructor datum: ' + message);
    }
    requireThat(Array.isArray(atoms) && Array.isArray(relations), 'missing atoms/relations');
    const byId = new Map();
    for (const a of atoms) {
      requireThat(a && typeof a.id === 'string' && typeof a.label === 'string'
        && VALUE_TYPES.concat(['CDPosition', 'CDFieldName']).includes(a.type), 'bad atom');
      requireThat(!byId.has(a.id), 'duplicate atom id');
      byId.set(a.id, a);
    }
    const byName = new Map();
    for (const r of relations) {
      requireThat(['cdRoot', 'cdArity', 'cdField'].includes(r.name)
        && !byName.has(r.name) && Array.isArray(r.tuples), 'bad relation');
      byName.set(r.name, r.tuples);
      for (const t of r.tuples) {
        const arity = { cdRoot: 1, cdArity: 2, cdField: 4 }[r.name];
        requireThat(Array.isArray(t.atoms) && t.atoms.length === arity
          && t.atoms.every(id => byId.has(id)), 'bad tuple or dangling reference');
      }
    }
    requireThat(byName.size === 3 && byName.get('cdRoot').length === 1, 'expected one root');
    function position(id) {
      const a = byId.get(id);
      requireThat(a.type === 'CDPosition' && /^(0|[1-9][0-9]*)$/.test(a.label)
        && Number.isSafeInteger(Number(a.label)), 'bad position');
      return Number(a.label);
    }
    const arities = new Map();
    for (const t of byName.get('cdArity')) {
      const [id, n] = t.atoms;
      requireThat(byId.get(id).type === 'CDConstructor' && !arities.has(id), 'bad constructor arity');
      arities.set(id, position(n));
    }
    const children = new Map();
    for (const t of byName.get('cdField')) {
      const [id, p, f, child] = t.atoms;
      requireThat(byId.get(id).type === 'CDConstructor' && byId.get(f).type === 'CDFieldName'
        && VALUE_TYPES.includes(byId.get(child).type), 'bad field');
      if (!children.has(id)) children.set(id, []);
      children.get(id).push({ index: position(p), name: byId.get(f).label, child });
    }
    const active = new Set();
    const rendered = new Map();
    function render(id) {
      requireThat(!active.has(id), 'cycle');
      if (rendered.has(id)) return rendered.get(id);
      const a = byId.get(id);
      let text;
      switch (a.type) {
        case 'CDString': text = quoteString(a.label); break;
        case 'CDBoolean':
          requireThat(a.label === 'true' || a.label === 'false', 'bad Boolean');
          text = a.label; break;
        case 'CDInteger': {
          const n = Number(a.label);
          requireThat(Number.isInteger(n) && n >= MIN_INTEGER && n <= MAX_INTEGER
            && String(n) === a.label, 'bad integer');
          text = a.label; break;
        }
        case 'CDSingleton':
          requireThat(a.label.length > 0, 'empty singleton name');
          text = a.label; break;
        case 'CDConstructor': {
          const fields = (children.get(id) || []).sort((x, y) => x.index - y.index);
          requireThat(a.label.length > 0 && arities.has(id) && fields.length === arities.get(id)
            && fields.every((f, i) => f.index === i)
            && new Set(fields.map(f => f.name)).size === fields.length, 'missing/duplicate constructor fields');
          active.add(id);
          text = a.label + '(' + fields.map(f => render(f.child)).join(', ') + ')';
          active.delete(id);
          break;
        }
        default: throw new Error('Invalid constructor datum: root/child is metadata');
      }
      rendered.set(id, text);
      return text;
    }
    return render(byName.get('cdRoot')[0].atoms[0]);
  }

  return { exportValue, inspectDatum, quoteString, UnsupportedValue, MIN_INTEGER, MAX_INTEGER };
}));
